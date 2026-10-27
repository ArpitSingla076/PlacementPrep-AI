import mongoose from 'mongoose';
import request from 'supertest';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Resume } from '../src/models/Resume.js';
import { JobAnalysis } from '../src/models/JobAnalysis.js';
import { InterviewSession } from '../src/models/InterviewSession.js';
import { PreparationPlan } from '../src/models/PreparationPlan.js';
import { JobApplication } from '../src/models/JobApplication.js';
import { QuizSession } from '../src/models/QuizSession.js';
import { KnowledgeDocument } from '../src/models/KnowledgeDocument.js';
import { DocumentChunk } from '../src/models/DocumentChunk.js';
import { ChatConversation } from '../src/models/ChatConversation.js';
import { UserQuota } from '../src/ai/quota.js';
import { LocalRetriever } from '../src/ai/rag/retriever.js';
import { waitForIngestion } from '../src/services/knowledge/ingestion.service.js';
import { makePdf, NOTES } from './sampleData.js';

export const ORIGIN = 'http://localhost:5173';

export async function setupDb() {
  await connectDB(process.env.MONGODB_URI);
  // Safety guard: we delete data between tests, so refuse to run against anything not named *_test.
  if (!mongoose.connection.name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${mongoose.connection.name}"`);
  }
  await Promise.all([User.init(), Resume.init(), JobAnalysis.init(), KnowledgeDocument.init(), DocumentChunk.init(), ChatConversation.init(), InterviewSession.init(), PreparationPlan.init(), JobApplication.init(), QuizSession.init()]); // make sure unique indexes exist before tests rely on them
}

export async function teardownDb() {
  await disconnectDB();
}

export async function clearDb() {
  await waitForIngestion(); // never leave a background job writing into the next test's data
  await Promise.all([User.deleteMany({}), Resume.deleteMany({}), JobAnalysis.deleteMany({}), KnowledgeDocument.deleteMany({}), DocumentChunk.deleteMany({}), ChatConversation.deleteMany({}), InterviewSession.deleteMany({}), PreparationPlan.deleteMany({}), JobApplication.deleteMany({}), QuizSession.deleteMany({})]);
}

export const makeApp = (opts) => createApp(opts);

/** App wired with a mock LLM, no retry delays and a generous quota (override quotaLimit to test limits). */
export const makeAiApp = (llm, { quotaLimit = 100 } = {}) =>
  createApp({
    authRateLimitMax: 10_000,
    llm,
    quota: new UserQuota({ limit: quotaLimit }),
    aiConfig: { retries: 0, retryBaseMs: 0, sleep: async () => {} },
  });

/** Turn on AI consent for a registered agent (what the Settings checkbox does). */
export async function grantConsent({ agent, csrfToken }) {
  const res = await agent.patch('/api/users/me').set('X-CSRF-Token', csrfToken).send({ aiDataConsent: true });
  if (res.status !== 200) throw new Error('consent failed');
}

export const validUser = (overrides = {}) => ({
  name: 'Asha Rao',
  email: 'asha@example.com',
  password: 'correct-horse-1',
  ...overrides,
});

/** Registers a user on a cookie-keeping agent; returns { agent, csrfToken, user }. */
export async function registerAgent(app, overrides = {}) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send(validUser(overrides));
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrfToken: res.body.data.csrfToken, user: res.body.data.user };
}

/** App wired for RAG tests: mock LLM, fake embedder, LOCAL retriever (FerretDB has no Atlas Vector Search). */
export function makeRagApp({ quizQuotaLimit = 100, planQuotaLimit = 100, interviewQuotaLimit = 100, llm, embedder, ingestLimit = 100, questionLimit = 100, minScore = 0, topK = 5 } = {}) {
  return createApp({
    authRateLimitMax: 10_000,
    llm, embedder,
    retriever: new LocalRetriever(),
    quota: new UserQuota({ limit: 100 }),
    chatQuota: new UserQuota({ limit: questionLimit }),
    ingestQuota: new UserQuota({ limit: ingestLimit }),
    interviewQuota: new UserQuota({ limit: interviewQuotaLimit }),
    planQuota: new UserQuota({ limit: planQuotaLimit }),
    quizQuota: new UserQuota({ limit: quizQuotaLimit }),
    aiConfig: { retries: 0, retryBaseMs: 0, sleep: async () => {} },
    ragConfig: { topK, numCandidates: 50, minScore, maxContextChars: 9000, retries: 0, retryBaseMs: 0, sleep: async () => {} },
  });
}

export const notesPdf = (name) => makePdf(NOTES[name]);

export const uploadDoc = (u, buffer, filename = 'notes.pdf', contentType = 'application/pdf') =>
  u.agent.post('/api/documents').set('X-CSRF-Token', u.csrfToken).attach('file', buffer, { filename, contentType });

/** Upload a sample notes PDF and wait until its background embedding job has finished. Returns the document id. */
export async function addNotes(u, name) {
  const res = await uploadDoc(u, notesPdf(name), name);
  if (![200, 202].includes(res.status)) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  await waitForIngestion();
  return res.body.data.document.id;
}

export { waitForIngestion };
