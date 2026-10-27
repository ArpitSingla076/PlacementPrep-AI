/**
 * `npm run rag:eval`  - runs the evaluation dataset through the REAL pipeline with YOUR provider and database.
 *
 * It creates a temporary user, ingests eval/corpus.js (a few tiny documents), asks every question in eval/dataset.js,
 * prints the metrics, saves a JSON report under eval/results/, and deletes everything it created.
 * Cost: a handful of embedding calls and about one LLM call per question that is not stopped by the threshold.
 * Needs: GEMINI_API_KEY, LLM_MODEL, EMBEDDING_MODEL, a reachable database and (if VECTOR_SEARCH_MODE=atlas) an ACTIVE index.
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { KnowledgeDocument } from '../src/models/KnowledgeDocument.js';
import { DocumentChunk } from '../src/models/DocumentChunk.js';
import { ChatConversation } from '../src/models/ChatConversation.js';
import { createLlmProvider, createEmbeddingProvider } from '../src/ai/providers/index.js';
import { createRetriever } from '../src/ai/rag/retriever.js';
import { UserQuota } from '../src/ai/quota.js';
import { runRagEvaluation } from '../src/ai/evaluation/runner.js';
import { QUESTIONS } from '../eval/dataset.js';
import { NOTES } from '../eval/corpus.js';

const llm = createLlmProvider(env);
const embedder = createEmbeddingProvider(env);
if (!llm.isConfigured || !embedder.isConfigured) {
  console.error('AI is not configured. Set GEMINI_API_KEY, LLM_MODEL and EMBEDDING_MODEL in server/.env (run npm run ai:check).');
  process.exit(1);
}

const pct = (x) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
let userId;
try {
  await connectDB(env.MONGODB_URI);
  const user = await User.create({ name: 'RAG Eval', email: `rag-eval-${Date.now()}@example.invalid`, passwordHash: 'x'.repeat(60) });
  userId = user._id;
  console.log(`Evaluating with LLM=${llm.model}, embeddings=${embedder.model}, vector search=${env.VECTOR_SEARCH_MODE}, topK=${env.RAG_TOP_K}, minScore=${env.RAG_MIN_SCORE}`);

  const deps = {
    llm, embedder, retriever: createRetriever(env),
    ingestQuota: new UserQuota({ limit: 1000 }), chatQuota: new UserQuota({ limit: 1000 }),
    ragConfig: { topK: env.RAG_TOP_K, numCandidates: env.RAG_NUM_CANDIDATES, minScore: env.RAG_MIN_SCORE, maxContextChars: env.RAG_MAX_CONTEXT_CHARS, retries: env.AI_MAX_RETRIES, retryBaseMs: env.AI_RETRY_BASE_MS },
  };
  const { results, summary } = await runRagEvaluation({
    userId, corpus: NOTES, questions: QUESTIONS, deps, log: (m) => console.log(`  ${m}`),
    searchableTimeoutMs: env.VECTOR_SEARCH_MODE === 'atlas' ? 120_000 : 0,
  });

  console.log('\nQuestion  type      status                 hit  rank  topScore  citations  support');
  for (const r of results) {
    console.log(`${r.id.padEnd(9)} ${r.type.padEnd(9)} ${r.status.padEnd(22)} ${String(r.retrieval?.hit ?? '-').padEnd(4)} ${String(r.retrieval?.rank ?? '-').padEnd(5)} ${(r.topScore ?? 0).toFixed(3).padEnd(9)} ${String(r.citationsValid).padEnd(10)} ${pct(r.strongSupport)}`);
  }
  console.log(`\nRetrieval: hit@${summary.retrieval.k} = ${pct(summary.retrieval.hitAtK)}, MRR = ${summary.retrieval.mrr?.toFixed(2)}`);
  console.log(`Answers:   answered ${pct(summary.answers.answeredShare)} of positives, citations valid ${pct(summary.answers.citationsValid)}, strongly supported ${pct(summary.answers.strongSupport)}`);
  console.log(`Negatives: correctly abstained on ${pct(summary.negatives.correctlyAbstained)}`);
  summary.caveats.forEach((c) => console.log(`  * ${c}`));

  const dir = path.resolve(import.meta.dirname, '../eval/results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rag-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ config: { llm: llm.model, embedding: embedder.model, topK: env.RAG_TOP_K, minScore: env.RAG_MIN_SCORE, mode: env.VECTOR_SEARCH_MODE }, summary, results }, null, 2));
  console.log(`\nReport saved to ${path.relative(process.cwd(), file)}`);
} catch (e) {
  console.error(`\nEvaluation failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (userId) {
    await Promise.all([KnowledgeDocument.deleteMany({ userId }), DocumentChunk.deleteMany({ userId }), ChatConversation.deleteMany({ userId }), User.deleteOne({ _id: userId })]).catch(() => {});
  }
  await disconnectDB().catch(() => {});
  void mongoose;
}
