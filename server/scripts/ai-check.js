/**
 * `npm run ai:check`  - verifies your Gemini setup against the REAL API using your own key.
 * `npm run ai:check -- --full`  - also runs one complete analysis on a built-in sample (no database, ~1 request).
 *
 * It never prints your API key. Run it after setting GEMINI_API_KEY, LLM_MODEL (and optionally EMBEDDING_MODEL).
 */
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { env } from '../src/config/env.js';
import { createLlmProvider } from '../src/ai/providers/index.js';
import { generateStructured } from '../src/ai/structured.js';
import { resumeAnalysisSchema } from '../src/ai/schemas/resumeAnalysis.schema.js';
import { SYSTEM_INSTRUCTION, buildUserPrompt } from '../src/ai/prompts/resumeAnalysis.v1.js';
import { evaluateRequirements } from '../src/services/analysis/scoring.js';
import { interviewGenerationSchema, interviewEvaluationSchema } from '../src/ai/schemas/interview.schema.js';
import { ragAnswerSchema } from '../src/ai/schemas/ragAnswer.schema.js';
import { planWritingSchema } from '../src/ai/schemas/plan.schema.js';
import { toProviderJsonSchema } from '../src/ai/jsonSchema.js';

const FULL = process.argv.includes('--full');
let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const warn = (m) => console.log(`  WARN  ${m}`);
const bad = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const section = (t) => console.log(`\n== ${t}`);
const short = (e) => (e?.message ?? String(e)).replace(/\s+/g, ' ').slice(0, 500);

console.log(`Provider: ${env.LLM_PROVIDER} | LLM_MODEL=${env.LLM_MODEL ?? '(not set)'} | EMBEDDING_MODEL=${env.EMBEDDING_MODEL ?? '(not set)'} | EMBEDDING_DIMENSIONS=${env.EMBEDDING_DIMENSIONS ?? '(default)'}`);
if (env.GEMINI_BASE_URL) warn(`GEMINI_BASE_URL is set (${new URL(env.GEMINI_BASE_URL).host}): requests go there instead of Google.`);

if (!env.GEMINI_API_KEY) {
  bad('GEMINI_API_KEY is not set. Create a key in Google AI Studio and put it in server/.env');
  process.exit(1);
}

const client = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
  httpOptions: { ...(env.GEMINI_BASE_URL && { baseUrl: env.GEMINI_BASE_URL }), timeout: env.AI_TIMEOUT_MS, retryOptions: { attempts: 1 } },
});

section('1. Models available to this API key');
const stripPrefix = (n) => String(n ?? '').replace(/^models\//, '');
const actions = (m) => m.supportedActions ?? m.supportedGenerationMethods ?? [];
let models = [];
try {
  for await (const m of await client.models.list()) models.push(m);
  const gen = models.filter((m) => actions(m).includes('generateContent')).map((m) => stripPrefix(m.name)).sort();
  const emb = models.filter((m) => actions(m).some((a) => /embed/i.test(a))).map((m) => stripPrefix(m.name)).sort();
  ok(`${models.length} models visible (${gen.length} generateContent, ${emb.length} embedding)`);
  console.log(`  generateContent: ${gen.join(', ') || '(none)'}`);
  console.log(`  embedding:       ${emb.join(', ') || '(none)'}`);
  if (env.LLM_MODEL) (gen.includes(stripPrefix(env.LLM_MODEL)) ? ok : bad)(`LLM_MODEL "${env.LLM_MODEL}" ${gen.includes(stripPrefix(env.LLM_MODEL)) ? 'supports generateContent' : 'was NOT found among generateContent models. Pick one from the list above.'}`);
  if (env.EMBEDDING_MODEL) (emb.includes(stripPrefix(env.EMBEDDING_MODEL)) ? ok : bad)(`EMBEDDING_MODEL "${env.EMBEDDING_MODEL}" ${emb.includes(stripPrefix(env.EMBEDDING_MODEL)) ? 'supports embedding' : 'was NOT found among embedding models.'}`);
} catch (e) {
  bad(`Could not list models: ${short(e)}`);
}

const llm = createLlmProvider(env);
section('2. Structured output with the app\'s real schema');
if (!llm.isConfigured) {
  bad('LLM_MODEL is not set. Choose a model from the list above and put it in server/.env');
} else {
  try {
    const tiny = z.object({ language: z.string(), isCompiled: z.enum(['yes', 'no']) }).strict();
    const r = await generateStructured({ provider: llm, systemInstruction: 'Answer with JSON only.', userPrompt: 'Describe the Java programming language.', schema: tiny, retries: 1 });
    ok(`responseJsonSchema accepted; got ${JSON.stringify(r.data)} (${r.usage.totalTokens} tokens)`);
  } catch (e) {
    bad(`Structured call failed: ${e.code ?? ''} ${short(e.cause ?? e)}`);
  }

  // Google rejects requests whose response schema it dislikes (HTTP 400). Test every feature's REAL schema on its own,
  // so a rejection names the exact feature instead of showing a generic error inside the app.
  section('2b. Every feature\'s response schema is accepted by Gemini');
  const probes = [
    ['resume analysis', resumeAnalysisSchema], ['interview questions', interviewGenerationSchema], ['interview evaluation', interviewEvaluationSchema],
    ['assistant answer', ragAnswerSchema], ['preparation plan', planWritingSchema(['weak_topic:example'])],
  ];
  for (const [name, schema] of probes) {
    try {
      const r = await llm.generate({ systemInstruction: 'Return a minimal valid JSON example for the schema: empty lists where allowed, very short text.', messages: [{ role: 'user', text: 'Produce the example.' }], jsonSchema: toProviderJsonSchema(schema), temperature: 0 });
      ok(`${name}: schema accepted`);
      let valid = false;
      try { valid = schema.safeParse(JSON.parse(r.text)).success; } catch { /* not JSON */ }
      if (!valid) warn(`${name}: the tiny example did not pass our validation (not a rejection; the real prompts are much more specific)`);
    } catch (e) {
      bad(`${name}: REJECTED by Gemini (${e.code ?? 'error'}): ${short(e.cause ?? e)}`);
    }
  }

  if (FULL) {
    section('3. Full sample analysis (uses the real prompt + schema + scoring)');
    const resume = 'Asha Rao\nSkills: Java, SQL, Git\nProjects\nBuilt a library system in Java using Spring and MySQL.\nDeveloped a chat app with Node.js and Express.';
    const jd = 'Backend Developer. Required: Java, SQL, REST APIs. Preferred: Docker. Nice to have: AWS. You will build and maintain backend services.';
    try {
      const r = await generateStructured({ provider: llm, systemInstruction: SYSTEM_INSTRUCTION, userPrompt: buildUserPrompt({ resumeText: resume, jobDescription: jd }), schema: resumeAnalysisSchema, retries: env.AI_MAX_RETRIES, retryBaseMs: env.AI_RETRY_BASE_MS });
      const { score, requirements } = evaluateRequirements(r.data.requirements, resume);
      ok(`validated analysis: ${requirements.length} requirements, score ${score.overall}/100, repaired=${r.repaired}, tokens=${r.usage.totalTokens}`);
      console.log('  ' + requirements.map((q) => `${q.skill}:${q.evidenceLevel}${q.verification === 'verified' ? '' : `(${q.verification})`}`).join('  '));
      if (score.counts.unverifiedClaims) warn(`${score.counts.unverifiedClaims} evidence claim(s) failed verification. This is expected to be rare. If frequent, try a stronger model.`);
    } catch (e) {
      bad(`Full analysis failed: ${e.code ?? ''} ${short(e.cause ?? e)}`);
    }
  } else {
    console.log('\n  (run with "-- --full" to also test a complete analysis)');
  }
}

section(`${FULL ? '4' : '3'}. Embeddings (for Milestone 3)`);
if (!env.EMBEDDING_MODEL) {
  warn('EMBEDDING_MODEL not set: skipping. Pick one from the embedding list above.');
} else {
  const probe = async (label, config) => {
    const res = await client.models.embedContent({ model: env.EMBEDDING_MODEL, contents: ['PlacementPrep embedding probe sentence.'], ...(config && { config }) });
    const v = res.embeddings?.[0]?.values ?? [];
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    console.log(`  ${label}: dimensions=${v.length}, L2 norm=${norm.toFixed(4)} (${Math.abs(norm - 1) < 0.01 ? 'unit length, no extra normalisation needed' : 'NOT unit length: normalise before cosine/dot-product search'})`);
    return v.length;
  };
  try {
    const def = await probe('default output', undefined);
    ok(`embedContent works; default dimension is ${def}`);
    if (env.EMBEDDING_DIMENSIONS) {
      const n = await probe(`outputDimensionality=${env.EMBEDDING_DIMENSIONS}`, { outputDimensionality: env.EMBEDDING_DIMENSIONS, taskType: 'RETRIEVAL_DOCUMENT' });
      (n === env.EMBEDDING_DIMENSIONS ? ok : bad)(`requested ${env.EMBEDDING_DIMENSIONS} dimensions, received ${n}`);
    }
    // The cookbook notes that list inputs may be merged into ONE embedding for some models. Verify batching yields one per item.
    // Exactly how the app calls it: one Content per text.
    const batch = await client.models.embedContent({ model: env.EMBEDDING_MODEL, contents: ['first chunk of text', 'second chunk of text', 'third chunk of text'].map((text) => ({ parts: [{ text }] })) });
    const count = batch.embeddings?.length ?? 0;
    (count === 3 ? ok : bad)(`batch of 3 texts returned ${count} embeddings${count === 3 ? '' : ' (batching needs per-item Content wrappers: handle in Milestone 3)'}`);
    // taskType (RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY) is used by default. Not every embedding model may accept it.
    try {
      await client.models.embedContent({ model: env.EMBEDDING_MODEL, contents: [{ parts: [{ text: 'task type probe' }] }], config: { taskType: 'RETRIEVAL_DOCUMENT', ...(env.EMBEDDING_DIMENSIONS && { outputDimensionality: env.EMBEDDING_DIMENSIONS }) } });
      ok('taskType RETRIEVAL_DOCUMENT is accepted (keep EMBEDDING_USE_TASK_TYPE=true)');
    } catch (e) {
      bad(`taskType was rejected (${short(e)}). Set EMBEDDING_USE_TASK_TYPE=false in server/.env`);
    }
    console.log(`\n  Atlas vector index to create: numDimensions = ${env.EMBEDDING_DIMENSIONS ?? def}, similarity = cosine (run: npm run vector:index)`);
  } catch (e) {
    bad(`Embedding probe failed: ${short(e)}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
