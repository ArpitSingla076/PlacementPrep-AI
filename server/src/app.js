import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import { originCheck } from './middleware/originCheck.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

import { createAuthRouter } from './routes/auth.routes.js';
import { createUserRouter } from './routes/user.routes.js';
import resumeRoutes from './routes/resume.routes.js';
import { createJobAnalysisRouter } from './routes/jobAnalysis.routes.js';
import { createAiRouter } from './routes/ai.routes.js';
import { createLlmProvider, createEmbeddingProvider } from './ai/providers/index.js';
import { createRetriever } from './ai/rag/retriever.js';
import { createDocumentRouter } from './routes/document.routes.js';
import applicationRoutes from './routes/application.routes.js';
import { createChatRouter } from './routes/chat.routes.js';
import { createQuizRouter } from './routes/quiz.routes.js';
import { createInterviewRouter } from './routes/interview.routes.js';
import { createPlanRouter, createProgressRouter } from './routes/plan.routes.js';
import { UserQuota } from './ai/quota.js';

export function createApp({
  authRateLimitMax = env.AUTH_RATE_LIMIT_MAX,
  apiRateLimitMax = env.API_RATE_LIMIT_MAX,
  llm = createLlmProvider(env),
  quota = new UserQuota({ limit: env.AI_QUOTA_PER_HOUR }),
  aiConfig = {
    retries: env.AI_MAX_RETRIES,
    retryBaseMs: env.AI_RETRY_BASE_MS,
  },
  embedder = createEmbeddingProvider(env),
  retriever = createRetriever(env),
  chatQuota = new UserQuota({ limit: env.QUESTIONS_PER_HOUR }),
  ingestQuota = new UserQuota({ limit: env.INGESTIONS_PER_HOUR }),
  interviewQuota = new UserQuota({ limit: env.INTERVIEW_CALLS_PER_HOUR }),
  planQuota = new UserQuota({ limit: env.PLAN_GENERATIONS_PER_HOUR }),
  quizQuota = new UserQuota({ limit: env.QUIZ_GENERATIONS_PER_HOUR }),
  ragConfig = {
    topK: env.RAG_TOP_K,
    numCandidates: env.RAG_NUM_CANDIDATES,
    minScore: env.RAG_MIN_SCORE,
    maxContextChars: env.RAG_MAX_CONTEXT_CHARS,
    retries: env.AI_MAX_RETRIES,
    retryBaseMs: env.AI_RETRY_BASE_MS,
  },
} = {}) {
  const app = express();

  app.disable('x-powered-by');

  // Trust Render's reverse proxy in production.
  if (env.IS_PROD) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());

  // Allow requests only from the configured frontend origin.
  // Strip any accidental trailing slash from the environment variable
  const allowedOrigin = env.CLIENT_ORIGIN ? env.CLIENT_ORIGIN.replace(/\/$/, '') : '';

  // The global app.use automatically intercepts and handles OPTIONS preflight requests
  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (e.g. health checks) are allowed.
        if (!origin || origin === allowedOrigin) {
          return callback(null, true);
        }

        console.warn(`[CORS Blocked] Received: ${origin} | Expected: ${allowedOrigin}`);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    })
  );

  if (!env.IS_TEST) {
    app.use(morgan('tiny'));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Protect state-changing requests against cross-site request forgery.
  app.use(originCheck);

  // API-wide rate limiting.
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: apiRateLimitMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/health',
      message: {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message:
            'Too many requests. Please slow down and try again in a few minutes.',
        },
      },
    })
  );

  // Health check.
  app.get('/api/health', (_req, res) => {
    const dbReady = mongoose.connection.readyState === 1;

    res.status(dbReady ? 200 : 503).json({
      success: dbReady,
      data: {
        status: dbReady ? 'ok' : 'database_unavailable',
      },
    });
  });

  // Authentication and user routes.
  app.use('/api/auth', createAuthRouter({ authRateLimitMax }));
  app.use('/api/users', createUserRouter({ authRateLimitMax }));

  // AI routes.
  app.use(
    '/api/ai',
    createAiRouter({
      llm,
      quota,
      embedder,
      chatQuota,
      ingestQuota,
      vectorMode: retriever.mode,
    })
  );

  app.use('/api/resumes', resumeRoutes);

  app.use(
    '/api/documents',
    createDocumentRouter({
      embedder,
      quota: ingestQuota,
    })
  );

  app.use(
    '/api/chat',
    createChatRouter({
      llm,
      embedder,
      retriever,
      quota: chatQuota,
      config: ragConfig,
    })
  );

  app.use(
    '/api/interviews',
    createInterviewRouter({
      llm,
      quota: interviewQuota,
      config: aiConfig,
    })
  );

  app.use(
    '/api/preparation-plans',
    createPlanRouter({
      llm,
      quota: planQuota,
      config: aiConfig,
    })
  );

  app.use('/api/progress', createProgressRouter());
  app.use('/api/applications', applicationRoutes);

  app.use(
    '/api/quizzes',
    createQuizRouter({
      llm,
      quota: quizQuota,
      config: aiConfig,
    })
  );

  app.use(
    '/api/job-analyses',
    createJobAnalysisRouter({
      llm,
      quota,
      config: aiConfig,
    })
  );

  // Keep these last.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}