import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { QuizSession } from '../src/models/QuizSession.js';
import { DocumentChunk } from '../src/models/DocumentChunk.js';
import { AiError } from '../src/ai/errors.js';
import { quizSchema } from '../src/ai/schemas/quiz.schema.js';
import { setupDb, teardownDb, clearDb, makeRagApp, registerAgent, grantConsent, addNotes } from './helpers.js';
import { quizLlm, fakeEmbedder } from './fixtures.js';

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

async function setup({ llm = quizLlm(), email = 'asha@example.com', consent = true, docs = ['dbms-notes.pdf', 'os-notes.pdf'], app, quizQuotaLimit } = {}) {
  app ??= makeRagApp({ llm, embedder: fakeEmbedder(), quizQuotaLimit });
  const u = await registerAgent(app, { email });
  const ids = {};
  if (consent) { await grantConsent(u); for (const d of docs) ids[d] = await addNotes(u, d); }
  return { ...u, app, llm, ids };
}
const create = (u, body = { numQuestions: 3 }) => u.agent.post('/api/quizzes').set('X-CSRF-Token', u.csrfToken).send(body);
const submit = (u, id, answers) => u.agent.post(`/api/quizzes/${id}/submit`).set('X-CSRF-Token', u.csrfToken).send({ answers });

describe('quiz schema', () => {
  const good = { sourceN: 1, question: 'Which statement is correct here?', options: ['a1', 'b2', 'c3', 'd4'], correctIndex: 2, explanation: 'Because the passage says so.', topic: 'Topic' };
  it('accepts a valid quiz and rejects bad citations, option counts, duplicates and indexes', () => {
    const s = quizSchema(2);
    expect(s.safeParse({ questions: [good] }).success).toBe(true);
    for (const bad of [{ ...good, sourceN: 3 }, { ...good, sourceN: 0 }, { ...good, options: ['a', 'b', 'c'] }, { ...good, options: ['a', 'A', 'c', 'd'] }, { ...good, correctIndex: 4 }, { ...good, extra: 1 }]) {
      expect(s.safeParse({ questions: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('POST /api/quizzes', () => {
  it('builds questions from passages of the user\'s own documents and hides answers, explanations and sources until submitted', async () => {
    const u = await setup();
    const res = await create(u, { numQuestions: 4 });
    expect(res.status).toBe(201);
    const quiz = res.body.data.quiz;
    expect(quiz.status).toBe('in_progress');
    expect(quiz.questions.length).toBeGreaterThan(0);
    expect(quiz.questions.every((q) => q.options.length === 4)).toBe(true);
    expect(JSON.stringify(quiz)).not.toMatch(/correctIndex|explanation|"source"|selectedIndex/);

    // every question is grounded in a passage that really is in the user's documents
    const stored = await QuizSession.findById(quiz.id);
    for (const q of stored.questions) {
      const chunk = await DocumentChunk.findOne({ _id: q.source.chunkId, userId: u.user.id });
      expect(chunk).toBeTruthy();
      expect(chunk.text).toBe(q.source.text);
      expect(q.options[q.correctIndex]).toMatch(/\w/);
    }
    expect(u.llm.prompts[0].prompt).toMatch(/<source n="1" document="(dbms|os)-notes\.pdf">/);
  });

  it('lets the SERVER decide where the right answer sits (the model always put it first)', async () => {
    const u = await setup();
    const positions = new Set();
    for (let i = 0; i < 3; i++) {
      const q = await create(u, { numQuestions: 5 });
      (await QuizSession.findById(q.body.data.quiz.id)).questions.forEach((x) => positions.add(x.correctIndex));
    }
    expect(positions.size).toBeGreaterThan(1); // with the model's answer always at index 0, a fixed server would give exactly {0}
  });

  it('shows the model only this user\'s passages (cross-user isolation) and can be scoped to chosen documents', async () => {
    const llm = quizLlm();
    const app = makeRagApp({ llm, embedder: fakeEmbedder() });
    const a = await setup({ app, llm, email: 'a@example.com', docs: ['dbms-notes.pdf'] });
    const b = await setup({ app, llm, email: 'b@example.com', docs: ['network-notes.pdf'] });
    await create(b);
    const prompt = llm.prompts.at(-1).prompt;
    expect(prompt).toMatch(/network-notes\.pdf/);
    expect(prompt).not.toMatch(/dbms-notes\.pdf|LEFT JOIN|Normalization/);

    const scoped = await setup({ email: 'c@example.com' });
    const q = await create(scoped, { numQuestions: 3, documentIds: [scoped.ids['os-notes.pdf']] });
    expect((await QuizSession.findById(q.body.data.quiz.id)).questions.every((x) => x.source.filename === 'os-notes.pdf')).toBe(true);
    expect((await create(scoped, { numQuestions: 3, documentIds: [a.ids['dbms-notes.pdf']] })).status).toBe(404); // someone else's document
    expect((await create(scoped, { numQuestions: 3, documentIds: ['nope'] })).status).toBe(404);
  });

  it('flags a question as weakly grounded when its answer shares little wording with the passage', async () => {
    const llm = quizLlm();
    llm.queue({ questions: [{ sourceN: 1, question: 'What does Kubernetes schedule onto nodes?', options: ['Containers', 'Tables', 'Frames', 'Packets'], correctIndex: 0, explanation: 'Controllers schedule containers onto worker nodes.', topic: 'Orchestration' }] });
    const u = await setup({ llm });
    const quiz = await QuizSession.findById((await create(u, { numQuestions: 3 })).body.data.quiz.id);
    expect(quiz.questions[0].weakGrounding).toBe(true);
  });

  it('requires consent and configuration, validates the request, needs documents, and enforces the quota', async () => {
    const noConsent = await setup({ consent: false });
    expect((await create(noConsent)).status).toBe(403);
    expect(noConsent.llm.generate).not.toHaveBeenCalled();

    const unconfigured = await setup({ llm: quizLlm({ configured: false }), email: 'b@example.com' });
    expect((await create(unconfigured)).body.error.code).toBe('AI_NOT_CONFIGURED');

    const none = await setup({ email: 'c@example.com', docs: [] });
    expect((await create(none)).body.error.code).toBe('NO_DOCUMENTS');

    const u = await setup({ email: 'd@example.com', quizQuotaLimit: 1 });
    for (const bad of [{ numQuestions: 2 }, { numQuestions: 11 }, { numQuestions: 'x' }, { numQuestions: 3, extra: 1 }]) expect((await create(u, bad)).status).toBe(400);
    expect((await create(u)).status).toBe(201);
    expect((await create(u)).body.error.code).toBe('AI_QUOTA_EXCEEDED');
  });

  it('fails cleanly (nothing saved, quota refunded) on provider errors and on invalid or ungrounded model output', async () => {
    const llm = quizLlm();
    llm.queue(new AiError(429, 'AI_RATE_LIMITED', 'The AI provider is rate limiting requests.', { retryable: true }));
    const u = await setup({ llm, quizQuotaLimit: 1 });
    expect((await create(u)).status).toBe(429);
    expect(await QuizSession.countDocuments()).toBe(0);

    const bad = { questions: [{ sourceN: 9, question: 'Cites a passage that was not provided?', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'Invalid citation.', topic: 'X' }] };
    llm.queue(bad, bad);
    const res = await create(u); // the quota slot was refunded, so this call is allowed
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_RESPONSE');
    expect(await QuizSession.countDocuments()).toBe(0);
  });
});

describe('submitting and reviewing', () => {
  it('grades in code, reveals answers, explanations and sources, and reports the score', async () => {
    const u = await setup();
    const quiz = (await create(u, { numQuestions: 4 })).body.data.quiz;
    const stored = await QuizSession.findById(quiz.id);
    const answers = stored.questions.map((q, i) => (i === 0 ? (q.correctIndex + 1) % 4 : q.correctIndex)); // first wrong, rest right
    const res = await submit(u, quiz.id, answers);
    expect(res.status).toBe(200);
    const done = res.body.data.quiz;
    const n = quiz.questions.length;
    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ correct: n - 1, total: n, percent: Math.round(((n - 1) / n) * 100) });
    expect(done.questions[0]).toMatchObject({ correct: false });
    expect(done.questions[1].correct).toBe(true);
    expect(done.questions.every((q) => q.explanation && q.source.text && q.source.filename && typeof q.correctIndex === 'number')).toBe(true);
    expect(u.llm.generate).toHaveBeenCalledTimes(1); // submitting made no AI call
    expect((await u.agent.get(`/api/quizzes/${quiz.id}`)).body.data.quiz.questions[0].correctIndex).toBeDefined();
  });

  it('counts skipped questions as wrong, and validates and locks submissions', async () => {
    const u = await setup();
    const quiz = (await create(u)).body.data.quiz;
    const n = quiz.questions.length;
    expect((await submit(u, quiz.id, Array(n).fill(null))).body.data.quiz.result.correct).toBe(0);
    expect((await submit(u, quiz.id, Array(n).fill(0))).body.error.code).toBe('QUIZ_COMPLETED');

    const q2 = (await create(u)).body.data.quiz;
    expect((await submit(u, q2.id, [0])).status).toBe(n === 1 ? 200 : 400); // wrong number of answers
    expect((await submit(u, q2.id, Array(n).fill(7))).status).toBe(400);
    expect((await submit(u, q2.id, Array(n).fill('a'))).status).toBe(400);
  });

  it('is private, paginated and deletable', async () => {
    const app = makeRagApp({ llm: quizLlm(), embedder: fakeEmbedder() });
    const a = await setup({ app, email: 'a@example.com' });
    const b = await setup({ app, email: 'b@example.com', docs: [] });
    const id = (await create(a)).body.data.quiz.id;
    await create(a);
    expect((await b.agent.get(`/api/quizzes/${id}`)).status).toBe(404);
    expect((await submit(b, id, [0, 0, 0])).status).toBe(404);
    expect((await b.agent.delete(`/api/quizzes/${id}`).set('X-CSRF-Token', b.csrfToken)).status).toBe(404);
    expect((await b.agent.get('/api/quizzes')).body.data.pagination.total).toBe(0);
    expect((await request(app).get('/api/quizzes')).status).toBe(401);

    const list = (await a.agent.get('/api/quizzes?limit=1&page=2')).body.data;
    expect(list.pagination).toMatchObject({ total: 2, totalPages: 2 });
    expect((await a.agent.delete(`/api/quizzes/${id}`).set('X-CSRF-Token', a.csrfToken)).status).toBe(200);
    expect(await QuizSession.countDocuments()).toBe(1);
  });

  it('deleting a document clears the passage text kept in quiz sources', async () => {
    const u = await setup({ docs: ['os-notes.pdf'] });
    const quiz = (await create(u)).body.data.quiz;
    expect((await u.agent.delete(`/api/documents/${u.ids['os-notes.pdf']}`).set('X-CSRF-Token', u.csrfToken)).status).toBe(200);
    const stored = await QuizSession.findById(quiz.id);
    expect(stored.questions.every((q) => q.source.documentDeleted === true && q.source.text === '')).toBe(true);
    // the quiz can still be taken and graded after the document is gone
    expect((await submit(u, quiz.id, stored.questions.map((q) => q.correctIndex))).body.data.quiz.result.percent).toBe(100);
  });
});
