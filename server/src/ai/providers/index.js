import { GeminiLlmProvider } from './gemini.js';
import { GeminiEmbeddingProvider } from './geminiEmbedding.js';

/** Provider factories: choose the implementation from LLM_PROVIDER / EMBEDDING_PROVIDER. Add new providers here. */
export function createLlmProvider(env) {
  switch (env.LLM_PROVIDER) {
    case 'gemini':
      return new GeminiLlmProvider({
        apiKey: env.GEMINI_API_KEY,
        model: env.LLM_MODEL,
        baseUrl: env.GEMINI_BASE_URL,
        timeoutMs: env.AI_TIMEOUT_MS,
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
        thinkingBudget: env.LLM_THINKING_BUDGET,
        thinkingLevel: env.LLM_THINKING_LEVEL,
      });
    default:
      throw new Error(`Unsupported LLM_PROVIDER "${env.LLM_PROVIDER}"`);
  }
}

export function createEmbeddingProvider(env) {
  switch (env.EMBEDDING_PROVIDER) {
    case 'gemini':
      return new GeminiEmbeddingProvider({
        apiKey: env.GEMINI_API_KEY, // one key serves both LLM and embeddings
        model: env.EMBEDDING_MODEL,
        dimensions: env.EMBEDDING_DIMENSIONS,
        baseUrl: env.GEMINI_BASE_URL,
        timeoutMs: env.AI_TIMEOUT_MS,
        batchSize: env.EMBEDDING_BATCH_SIZE,
        useTaskType: env.EMBEDDING_USE_TASK_TYPE,
        retries: env.AI_MAX_RETRIES,
        retryBaseMs: env.AI_RETRY_BASE_MS,
      });
    default:
      throw new Error(`Unsupported EMBEDDING_PROVIDER "${env.EMBEDDING_PROVIDER}"`);
  }
}
