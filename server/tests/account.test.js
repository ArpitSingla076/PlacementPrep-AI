import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { User } from '../src/models/User.js';
import { Resume } from '../src/models/Resume.js';
import { JobAnalysis } from '../src/models/JobAnalysis.js';
import { KnowledgeDocument } from '../src/models/KnowledgeDocument.js';
import { DocumentChunk } from '../src/models/DocumentChunk.js';
import { ChatConversation } from '../src/models/ChatConversation.js';
import { InterviewSession } from '../src/models/InterviewSession.js';
import { PreparationPlan } from '../src/models/PreparationPlan.js';
import { JobApplication } from '../src/models/JobApplication.js';
import { QuizSession } from '../src/models/QuizSession.js';
import { USER_OWNED_MODELS } from '../src/models/index.js';
import { setupDb, teardownDb, clearDb, makeRagApp, registerAgent, grantConsent, addNotes } from './helpers.js';
import { ragLlm, fakeEmbedder } from './fixtures.js';

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

const PW = 'correct-horse-1';
const setup = async (email = 'asha@example.com', app = makeRagApp({ llm: ragLlm(), embedder: fakeEmbedder() })) => {
  const u = await registerAgent(app, { email });
  await grantConsent(u);
  return { ...u, app };
};

/** Give a user at least one record in every collection that stores user data. */
async function seedEverything(u) {
  const userId = u.user.id;
  await addNotes(u, 'os-notes.pdf');
  await Resume.create({ userId, originalFilename: 'r.pdf', sizeBytes: 1, pageCount: 1, charCount: 9, extractedText: 'PRIVATE RESUME TEXT', textHash: 'h' });
  await JobAnalysis.create({ userId, resumeId: userId, jobDescription: 'jd', inputHash: 'h', requirements: [], score: { overall: 1 } });
  await ChatConversation.create({ userId, title: 't', messages: [{ role: 'user', content: 'q' }] });
  await InterviewSession.create({ userId, targetRole: 'r', experienceLevel: 'fresher', category: 'c', difficulty: 'easy', questions: [] });
  await PreparationPlan.create({ userId, generatedAt: new Date(), items: [] });
  await JobApplication.create({ userId, company: 'Acme', roleTitle: 'Dev' });
  await QuizSession.create({ userId, title: 'q', questions: [] });
}

describe('registry of user-owned data', () => {
  it('lists EVERY model that has a userId field, so deletion and export can never miss a collection', () => {
    const owned = new Set(USER_OWNED_MODELS.map((m) => m.modelName));
    const withUserId = Object.values(mongoose.models).filter((m) => m.schema.path('userId')).map((m) => m.modelName);
    expect(withUserId.length).toBeGreaterThanOrEqual(9);
    expect(withUserId.filter((n) => !owned.has(n))).toEqual([]);
  });
});

describe('POST /api/users/me/password', () => {
  it('changes the password, keeps this device signed in, signs out other devices, and the old password stops working', async () => {
    const u = await setup();
    const other = request.agent(u.app);
    await other.post('/api/auth/login').send({ email: 'asha@example.com', password: PW });
    expect((await other.get('/api/auth/me')).status).toBe(200);

    const res = await u.agent.post('/api/users/me/password').set('X-CSRF-Token', u.csrfToken).send({ currentPassword: PW, newPassword: 'brand-new-pass-2' });
    expect(res.status).toBe(200);
    expect(res.body.data.csrfToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/brand-new|passwordHash/);

    const stored = await User.findOne({}).select('+passwordHash');
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect((await u.agent.get('/api/auth/me')).status).toBe(200); // this device got a fresh session
    expect((await other.get('/api/auth/me')).status).toBe(401); // the other device was signed out
    expect((await request(u.app).post('/api/auth/login').send({ email: 'asha@example.com', password: PW })).status).toBe(401);
    expect((await request(u.app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'brand-new-pass-2' })).status).toBe(200);
  });

  it('rejects a wrong current password, a weak new password, an unchanged password and unknown fields', async () => {
    const u = await setup();
    const post = (body) => u.agent.post('/api/users/me/password').set('X-CSRF-Token', u.csrfToken).send(body);
    const wrong = await post({ currentPassword: 'not-my-password-1', newPassword: 'brand-new-pass-2' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    expect((await post({ currentPassword: PW, newPassword: 'short1' })).status).toBe(400);
    expect((await post({ currentPassword: PW, newPassword: PW })).status).toBe(400);
    expect((await post({ currentPassword: PW, newPassword: 'brand-new-pass-2', role: 'admin' })).status).toBe(400);
  });

  it('needs a session and the CSRF header, and is rate limited like login', async () => {
    const u = await setup();
    expect((await request(u.app).post('/api/users/me/password').send({})).status).toBe(401);
    expect((await u.agent.post('/api/users/me/password').send({ currentPassword: PW, newPassword: 'brand-new-pass-2' })).status).toBe(403);
  });
});

describe('GET /api/users/me/export', () => {
  it('exports everything the user owns (including notes text) but no password hash, vectors or other users\' data', async () => {
    const app = makeRagApp({ llm: ragLlm(), embedder: fakeEmbedder() });
    const a = await setup('a@example.com', app);
    const b = await setup('b@example.com', app);
    await seedEverything(a);
    await JobApplication.create({ userId: b.user.id, company: 'BOBS SECRET CO', roleTitle: 'x' });

    const res = await a.agent.get('/api/users/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="placementprep-export\.json"/);
    const d = res.body.data;
    expect(d.profile.email).toBe('a@example.com');
    expect(d.resumes[0].extractedText).toBe('PRIVATE RESUME TEXT');
    expect(d.documents[0].chunks.length).toBeGreaterThan(0);
    expect(d.documents[0].chunks[0].text).toMatch(/\w/);
    expect([d.jobAnalyses, d.conversations, d.interviews, d.applications, d.quizzes].every((x) => x.length === 1)).toBe(true);
    expect(d.preparationPlan).toBeTruthy();

    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/passwordHash|tokenVersion|contentHash|"embedding"/);
    expect(text).not.toContain('BOBS SECRET CO');
    expect((await request(app).get('/api/users/me/export')).status).toBe(401);
  });
});

describe('DELETE /api/users/me', () => {
  it('requires the correct password, then deletes the account and EVERY record in every collection, and signs out', async () => {
    const app = makeRagApp({ llm: ragLlm(), embedder: fakeEmbedder() });
    const a = await setup('a@example.com', app);
    const b = await setup('b@example.com', app);
    await seedEverything(a); await seedEverything(b);

    const wrong = await a.agent.delete('/api/users/me').set('X-CSRF-Token', a.csrfToken).send({ password: 'wrong-pass-1' });
    expect(wrong.status).toBe(403);
    expect(await User.countDocuments({ email: 'a@example.com' })).toBe(1); // nothing was deleted

    const res = await a.agent.delete('/api/users/me').set('X-CSRF-Token', a.csrfToken).send({ password: PW });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.deleted)).toEqual(USER_OWNED_MODELS.map((m) => m.modelName));

    for (const Model of [Resume, JobAnalysis, KnowledgeDocument, DocumentChunk, ChatConversation, InterviewSession, PreparationPlan, JobApplication, QuizSession]) {
      expect(await Model.countDocuments({ userId: a.user.id }), Model.modelName).toBe(0);
    }
    expect(await User.countDocuments({ email: 'a@example.com' })).toBe(0);
    expect((await a.agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'a@example.com', password: PW })).status).toBe(401);

    // user B is untouched
    expect(await User.countDocuments({ email: 'b@example.com' })).toBe(1);
    expect(await DocumentChunk.countDocuments({ userId: b.user.id })).toBeGreaterThan(0);
    expect(await JobApplication.countDocuments({ userId: b.user.id })).toBe(1);
    expect((await b.agent.get('/api/auth/me')).status).toBe(200);
  });

  it('removes a document that was still being embedded when the account was deleted', async () => {
    const embedder = fakeEmbedder();
    embedder.delayMs = 150;
    const app = makeRagApp({ llm: ragLlm(), embedder });
    const u = await setup('a@example.com', app);
    const { notesPdf, uploadDoc } = await import('./helpers.js');
    await uploadDoc(u, notesPdf('dbms-notes.pdf'));
    const res = await u.agent.delete('/api/users/me').set('X-CSRF-Token', u.csrfToken).send({ password: PW });
    expect(res.status).toBe(200);
    expect(await DocumentChunk.countDocuments()).toBe(0);
    expect(await KnowledgeDocument.countDocuments()).toBe(0);
  });

  it('needs the CSRF header and a body with the password', async () => {
    const u = await setup();
    expect((await u.agent.delete('/api/users/me').send({ password: PW })).status).toBe(403);
    expect((await u.agent.delete('/api/users/me').set('X-CSRF-Token', u.csrfToken).send({})).status).toBe(400);
  });
});
