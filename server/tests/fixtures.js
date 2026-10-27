import { vi } from 'vitest';
export * from './sampleData.js';
import { analysisJson } from './sampleData.js';

/** Mock LLM that satisfies the provider contract. Queue responses (objects, strings or Errors); default is a valid analysis. */
export function mockLlm({ configured = true } = {}) {
  const queue = [];
  const llm = {
    name: 'mock',
    model: configured ? 'mock-model-1' : undefined,
    isConfigured: configured,
    describe: () => ({ provider: 'mock', model: configured ? 'mock-model-1' : null, configured }),
    queue: (...items) => queue.push(...items),
    delayMs: 0,
    generate: vi.fn(async () => {
      if (llm.delayMs) await new Promise((r) => setTimeout(r, llm.delayMs));
      const next = queue.length ? queue.shift() : analysisJson();
      if (next instanceof Error) throw next;
      return { text: typeof next === 'string' ? next : JSON.stringify(next), finishReason: 'STOP', usage: { promptTokens: 1000, outputTokens: 500, totalTokens: 1500 } };
    }),
  };
  return llm;
}

// ---------------------------------------------------------------- RAG test doubles
import { hashEmbed } from './fakeEmbedding.js';
import { faithfulRagAnswer } from './ragFake.js';

export const FAKE_DIMS = 512;

/** Embedding provider double (satisfies the provider contract) using the deterministic test embedding. */
export function fakeEmbedder({ configured = true, dimensions = FAKE_DIMS } = {}) {
  const e = {
    name: 'fake', model: configured ? 'fake-embed' : undefined, dimensions, isConfigured: configured,
    describe: () => ({ provider: 'fake', model: configured ? 'fake-embed' : null, dimensions, configured }),
    delayMs: 0,
    embed: vi.fn(async ({ texts }) => {
      if (e.delayMs) await new Promise((r) => setTimeout(r, e.delayMs));
      return texts.map((t) => hashEmbed(t, dimensions));
    }),
  };
  return e;
}

/**
 * LLM double for RAG. By default it behaves like a faithful model: it reads the sources FROM THE PROMPT IT RECEIVES,
 * picks the one overlapping the question most, and answers with that source's first sentence, citing it.
 * Queue Errors / strings / objects to script other behaviours. `prompts` records everything it was shown.
 */
export function ragLlm({ configured = true } = {}) {
  const queue = [];
  const llm = {
    name: 'mock', model: configured ? 'mock-model-1' : undefined, isConfigured: configured,
    describe: () => ({ provider: 'mock', model: configured ? 'mock-model-1' : null, configured }),
    queue: (...items) => queue.push(...items),
    prompts: [],
    generate: vi.fn(async ({ systemInstruction, messages }) => {
      const prompt = messages[0].text;
      llm.prompts.push({ systemInstruction, prompt });
      const next = queue.length ? queue.shift() : null;
      if (next instanceof Error) throw next;
      const body = next ?? faithfulRagAnswer(prompt);
      return { text: typeof body === 'string' ? body : JSON.stringify(body), finishReason: 'STOP', usage: { promptTokens: 800, outputTokens: 120, totalTokens: 920 } };
    }),
  };
  return llm;
}

/**
 * LLM double for mock interviews. Question generation returns N questions (N parsed from the prompt). Evaluation reads the
 * rubric and the answer from the prompt: a key point counts as covered if its first word occurs in the answer.
 * It deliberately returns correctness 5 even when nothing is covered, so tests can prove the server caps it.
 */
export function interviewLlm({ configured = true } = {}) {
  const queue = [];
  const llm = {
    name: 'mock', model: configured ? 'mock-model-1' : undefined, isConfigured: configured,
    describe: () => ({ provider: 'mock', model: configured ? 'mock-model-1' : null, configured }),
    queue: (...items) => queue.push(...items), prompts: [],
    generate: vi.fn(async ({ systemInstruction, messages }) => {
      const prompt = messages[0].text;
      llm.prompts.push({ systemInstruction, prompt });
      const next = queue.length ? queue.shift() : null;
      if (next instanceof Error) throw next;
      let body = next;
      if (body === null && /writing questions/.test(systemInstruction)) {
        const n = Number(/Number of questions: (\d+)/.exec(prompt)[1]);
        body = { questions: Array.from({ length: n }, (_, i) => ({
          question: `Question ${i + 1}: explain the concept of ${i % 2 ? 'normalization' : 'SQL joins'} in detail.`,
          topic: i % 2 ? 'Normalization' : 'SQL joins', difficulty: 'medium', keyPoints: ['atomic values per column', 'primary key dependency', 'partial dependencies removed'],
        })) };
      } else if (body === null) {
        const answer = (/<answer>\n([\s\S]*?)\n<\/answer>/.exec(prompt)?.[1] ?? '').toLowerCase();
        const points = [...prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1].toLowerCase());
        body = {
          coveredPoints: points.map((p) => answer.includes(p.split(' ')[0])),
          correctness: 5, relevance: 4, clarity: 3,
          whatWasCorrect: ['Mentioned relevant ideas.'], missingOrIncorrect: ['Could be more complete.'],
          strongerAnswer: 'A strong answer states atomic values, primary key dependency and removal of partial dependencies.', followUp: 'How does this relate to denormalization?',
        };
      }
      return { text: typeof body === 'string' ? body : JSON.stringify(body), finishReason: 'STOP', usage: { promptTokens: 500, outputTokens: 200, totalTokens: 700 } };
    }),
  };
  return llm;
}

/** LLM double for plan writing: answers with one entry per "key:" it finds in the prompt (or whatever is queued). */
export function planLlm({ configured = true } = {}) {
  const queue = [];
  const llm = {
    name: 'mock', model: configured ? 'mock-model-1' : undefined, isConfigured: configured,
    describe: () => ({ provider: 'mock', model: configured ? 'mock-model-1' : null, configured }),
    queue: (...items) => queue.push(...items), prompts: [],
    generate: vi.fn(async ({ systemInstruction, messages }) => {
      const prompt = messages[0].text;
      llm.prompts.push({ systemInstruction, prompt });
      const next = queue.length ? queue.shift() : null;
      if (next instanceof Error) throw next;
      const keys = [...prompt.matchAll(/^- key: (.+)$/gm)].map((m) => m[1]);
      const body = next ?? { items: keys.map((key) => ({ key, action: `Revise ${key.split(':')[1]} using your notes.`, practice: [{ type: 'question', text: `Explain ${key.split(':')[1]} in your own words.` }] })) };
      return { text: typeof body === 'string' ? body : JSON.stringify(body), finishReason: 'STOP', usage: { promptTokens: 300, outputTokens: 150, totalTokens: 450 } };
    }),
  };
  return llm;
}

/** LLM double for quizzes. Reads the numbered passages from the prompt it receives (or returns whatever is queued). */
import { fakeQuiz } from './aiFakes.js';
export function quizLlm({ configured = true } = {}) {
  const queue = [];
  const llm = {
    name: 'mock', model: configured ? 'mock-model-1' : undefined, isConfigured: configured,
    describe: () => ({ provider: 'mock', model: configured ? 'mock-model-1' : null, configured }),
    queue: (...items) => queue.push(...items), prompts: [],
    generate: vi.fn(async ({ systemInstruction, messages }) => {
      const prompt = messages[0].text;
      llm.prompts.push({ systemInstruction, prompt });
      const next = queue.length ? queue.shift() : null;
      if (next instanceof Error) throw next;
      const body = next ?? fakeQuiz(prompt);
      return { text: typeof body === 'string' ? body : JSON.stringify(body), finishReason: 'STOP', usage: { promptTokens: 700, outputTokens: 300, totalTokens: 1000 } };
    }),
  };
  return llm;
}
