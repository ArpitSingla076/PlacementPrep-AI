import { z } from 'zod';

/**
 * Environment validation (see README for every variable).
 * Empty strings ("LLM_MODEL=" in a .env file) are treated as "not set".
 */
const blankToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = (schema) => z.preprocess(blankToUndefined, schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  CLIENT_URL: z.url().default('http://localhost:5173'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000), // all /api requests per IP per 15 minutes (a coarse abuse guard)
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(180_000), // must exceed AI_TIMEOUT_MS plus retries
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  // ---- LLM (Milestone 2). Nothing here has a model default on purpose: model IDs change often,
  // so the operator must choose one explicitly (run `npm run ai:check` to see what your key can use).
  LLM_PROVIDER: z.enum(['gemini']).default('gemini'),
  GEMINI_API_KEY: optional(z.string().trim().min(10)),
  LLM_MODEL: optional(z.string().trim().min(1)),
  // Optional: point the SDK at a different Gemini-compatible endpoint (proxy / local test server).
  GEMINI_BASE_URL: optional(z.url()),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).max(65536).default(8192),
  // Thinking models spend output tokens on hidden reasoning. Leave unset to use the model default.
  // Older "2.x" models use a token budget (0 = off); newer ones use a level. Setting an unsupported option makes the API reject the call.
  LLM_THINKING_BUDGET: optional(z.coerce.number().int().min(-1)),
  LLM_THINKING_LEVEL: optional(z.enum(['minimal', 'low', 'medium', 'high'])),

  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2), // retries AFTER the first attempt
  AI_RETRY_BASE_MS: z.coerce.number().int().min(0).default(1500),
  AI_QUOTA_PER_HOUR: z.coerce.number().int().min(1).default(10), // provider-calling analyses per user per hour

  // ---- Embeddings (configured now, used from Milestone 3)
  EMBEDDING_PROVIDER: z.enum(['gemini']).default('gemini'),
  EMBEDDING_MODEL: optional(z.string().trim().min(1)),
  EMBEDDING_DIMENSIONS: optional(z.coerce.number().int().min(8).max(8192)),

  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(16),
  // Some embedding models may not support taskType. Turn off if ai:check or the API reports it is unsupported.
  EMBEDDING_USE_TASK_TYPE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // ---- RAG (Milestone 3)
  // 'atlas' = MongoDB Atlas Vector Search ($vectorSearch). 'local' = cosine similarity in Node: for tests and local
  // development WITHOUT Atlas only (loads all of a user's vectors per question; not for production).
  VECTOR_SEARCH_MODE: z.enum(['atlas', 'local']).default('atlas'),
  VECTOR_INDEX_NAME: z.string().min(1).default('chunk_embedding_index'),
  CHUNK_SIZE_CHARS: z.coerce.number().int().min(200).max(8000).default(1200),
  CHUNK_OVERLAP_CHARS: z.coerce.number().int().min(0).default(200),
  RAG_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
  RAG_NUM_CANDIDATES: z.coerce.number().int().min(1).max(1000).default(50),
  // Minimum similarity (0..1, where 0.5 = orthogonal vectors) for a passage to be used. 0 = off. Tune with `npm run rag:eval`.
  RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0),
  RAG_MAX_CONTEXT_CHARS: z.coerce.number().int().min(1000).default(9000),
  MAX_QUESTION_CHARS: z.coerce.number().int().min(50).default(1000),
  QUESTIONS_PER_HOUR: z.coerce.number().int().min(1).default(30),
  INGESTIONS_PER_HOUR: z.coerce.number().int().min(1).default(10),
  MAX_DOC_UPLOAD_MB: z.coerce.number().positive().max(50).default(10),
  MAX_DOCS_PER_USER: z.coerce.number().int().min(1).default(20),
  MAX_DOC_PAGES: z.coerce.number().int().min(1).max(500).default(100),
  MAX_CHUNKS_PER_DOC: z.coerce.number().int().min(1).default(400),

  // ---- Mock interviews (Milestone 4)
  INTERVIEW_CALLS_PER_HOUR: z.coerce.number().int().min(1).default(60), // question generation + answer evaluation calls per user per hour
  PLAN_GENERATIONS_PER_HOUR: z.coerce.number().int().min(1).default(5),
  QUIZ_GENERATIONS_PER_HOUR: z.coerce.number().int().min(1).default(10),
  MAX_APPLICATIONS_PER_USER: z.coerce.number().int().min(1).default(200),
  MAX_QUIZZES_PER_USER: z.coerce.number().int().min(1).default(50),
  MAX_ANSWER_CHARS: z.coerce.number().int().min(200).default(4000),
  MAX_INTERVIEW_JD_CHARS: z.coerce.number().int().min(200).default(4000),

  // ---- Upload / content limits
  MAX_UPLOAD_MB: z.coerce.number().positive().max(25).default(5),
  MAX_RESUMES_PER_USER: z.coerce.number().int().min(1).default(10),
  MAX_RESUME_PAGES: z.coerce.number().int().min(1).max(30).default(6),
  MAX_RESUME_CHARS: z.coerce.number().int().min(1000).default(25_000),
  MIN_RESUME_CHARS: z.coerce.number().int().min(10).default(200),
  MAX_JD_CHARS: z.coerce.number().int().min(500).default(10_000),
  MIN_JD_CHARS: z.coerce.number().int().min(10).default(100),
});

export function loadEnv(source = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Names and messages only - never values (they may be secrets).
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.CHUNK_OVERLAP_CHARS >= env.CHUNK_SIZE_CHARS / 2) {
    throw new Error('Invalid environment configuration:\n  - CHUNK_OVERLAP_CHARS: must be less than half of CHUNK_SIZE_CHARS');
  }
  return {
    ...env,
    CLIENT_ORIGIN: new URL(env.CLIENT_URL).origin,
    MAX_UPLOAD_BYTES: Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024),
    MAX_DOC_UPLOAD_BYTES: Math.floor(env.MAX_DOC_UPLOAD_MB * 1024 * 1024),
    IS_PROD: env.NODE_ENV === 'production',
    IS_TEST: env.NODE_ENV === 'test',
  };
}

export const env = loadEnv();
