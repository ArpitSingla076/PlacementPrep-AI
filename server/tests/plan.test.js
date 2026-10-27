import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { InterviewSession } from '../src/models/InterviewSession.js';
import { JobAnalysis } from '../src/models/JobAnalysis.js';
import { PreparationPlan } from '../src/models/PreparationPlan.js';
import { KnowledgeDocument } from '../src/models/KnowledgeDocument.js';
import { DocumentChunk } from '../src/models/DocumentChunk.js';
import { AiError } from '../src/ai/errors.js';
import { topicStats, interviewItems, analysisItems, buildItems, carryCompletion } from '../src/services/plan/recommendations.js';
import { setupDb, teardownDb, clearDb, makeRagApp, registerAgent, grantConsent } from './helpers.js';
import { planLlm, fakeEmbedder } from './fixtures.js';

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

// ---- seeding: controlled, SAVED results (what the plan is allowed to look at)
const ev = (overall) => ({ overall, scores: { correctness: 3, completeness: 3, relevance: 3, clarity: 3 } });
const q = (topic, overall) => ({ question: `About ${topic}`, topic, topicKey: topic.toLowerCase(), keyPoints: ['a', 'b'], answer: 'SECRET ANSWER TEXT', answeredAt: new Date(), evaluation: ev(overall) });
const seedSession = (userId, topics, over = {}) => InterviewSession.create({
  userId, targetRole: 'Dev', experienceLevel: 'fresher', category: 'DBMS and SQL', difficulty: 'medium', status: 'completed', ...over,
  questions: topics.map(([t, s]) => q(t, s)),
  aggregate: topics.length ? { answered: topics.length, average: Math.round(topics.reduce((a, [, s]) => a + s, 0) / topics.length) } : undefined,
});
const req = (skill, importance, evidenceLevel, credit, weight = { required: 3, preferred: 2, bonus: 1 }[importance]) => ({ skill, importance, evidenceLevel, credit, weight, category: 'tool' });
const seedAnalysis = (userId, requirements, over = {}) => JobAnalysis.create({ userId, resumeId: userId, roleTitle: 'Backend Developer', jobDescription: 'x', inputHash: String(Math.random()), score: { overall: 42 }, requirements, ...over });

async function setup({ llm = planLlm(), email = 'asha@example.com', consent = true, app, planQuotaLimit } = {}) {
  app ??= makeRagApp({ llm, embedder: fakeEmbedder(), planQuotaLimit });
  const u = await registerAgent(app, { email });
  if (consent) await grantConsent(u);
  return { ...u, app, llm };
}
const generate = (u, body = {}) => u.agent.post('/api/preparation-plans/generate').set('X-CSRF-Token', u.csrfToken).send(body);
const tick = (u, key, completed) => u.agent.patch(`/api/preparation-plans/current/items/${encodeURIComponent(key)}`).set('X-CSRF-Token', u.csrfToken).send({ completed });

describe('recommendation rules (pure, deterministic)', () => {
  const sessions = (...specs) => specs.map((topics, i) => ({ _id: i, questions: topics.map(([t, s]) => q(t, s)) }));

  it('computes per-topic averages and counts DIFFERENT interviews where the topic was weak', () => {
    const stats = topicStats(sessions([['SQL joins', 30], ['SQL joins', 50]], [['SQL joins', 40]], [['SQL joins', 90]]));
    expect(stats.get('sql joins')).toMatchObject({ attempts: 4, average: 53, sessions: 3, sessionsBelow: 2 });
  });

  it('flags a weakness only with enough evidence: repeated or very low -> high, mildly low -> medium, one answer -> watch', () => {
    const items = Object.fromEntries(interviewItems(topicStats(sessions(
      [['Repeated', 50], ['Veryloww', 30], ['Mild', 55], ['Mild', 58], ['Single', 20], ['Strong', 85]],
      [['Repeated', 55], ['Veryloww', 35]],
    ))).map((i) => [i.topic, i]));

    expect(items.Repeated).toMatchObject({ kind: 'weak_topic', priority: 'high', evidenceType: 'observed_performance' });
    expect(items.Repeated.reason).toMatch(/repeated weakness/);
    expect(items.Veryloww.priority).toBe('high'); // average below 40
    expect(items.Mild.priority).toBe('medium'); // 2 weak answers but in ONE interview: not yet a repeated pattern
    expect(items.Single).toMatchObject({ kind: 'watch', priority: 'low', evidenceType: 'limited_evidence' });
    expect(items.Single.reason).toMatch(/not enough to call it a weakness/);
    expect(items.Strong).toBeUndefined(); // strong topics generate nothing
  });

  it('turns resume gaps into items by importance and evidence, skips fully evidenced skills, and caps the list', () => {
    const analysis = { requirements: [req('Docker', 'required', 'none', 0), req('SQL', 'required', 'listed', 0.5), req('AWS', 'preferred', 'none', 0), req('Java', 'required', 'demonstrated', 1)] };
    const out = Object.fromEntries(analysisItems(analysis).map((i) => [i.topic, i]));
    expect(out.Docker).toMatchObject({ priority: 'high', evidenceType: 'resume_analysis', kind: 'skill_gap' });
    expect(out.SQL.priority).toBe('medium');
    expect(out.AWS.priority).toBe('low');
    expect(out.Java).toBeUndefined();
    const many = { requirements: Array.from({ length: 20 }, (_, i) => req(`Skill${i}`, 'required', 'none', 0)) };
    expect(analysisItems(many)).toHaveLength(8);
  });

  it('orders high before medium before low and never exceeds 12 items', () => {
    const analysis = { requirements: Array.from({ length: 8 }, (_, i) => req(`S${i}`, 'required', 'none', 0)) };
    const stats = topicStats(sessions(Array.from({ length: 8 }, (_, i) => [`T${i}`, 30]), Array.from({ length: 8 }, (_, i) => [`T${i}`, 30])));
    const items = buildItems({ stats, analysis });
    expect(items).toHaveLength(12);
    const ranks = items.map((i) => ({ high: 0, medium: 1, low: 2 }[i.priority]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('keeps completion, but REOPENS a weak topic that got new answers after it was ticked off', () => {
    const prev = [
      { key: 'weak_topic:a', completed: true, completedAt: new Date(), completedAtAttempts: 2 },
      { key: 'weak_topic:b', completed: true, completedAt: new Date(), completedAtAttempts: 2 },
      { key: 'skill_gap:c', completed: true, completedAt: new Date(), completedAtAttempts: 0 },
    ];
    const next = carryCompletion([
      { key: 'weak_topic:a', kind: 'weak_topic', observed: { attempts: 2 } },
      { key: 'weak_topic:b', kind: 'weak_topic', observed: { attempts: 4 } },
      { key: 'skill_gap:c', kind: 'skill_gap', observed: {} },
      { key: 'weak_topic:new', kind: 'weak_topic', observed: { attempts: 2 } },
    ], prev);
    expect(next.map((i) => !!i.completed)).toEqual([true, false, true, false]);
    expect(next[1].reopenedNote).toMatch(/2 more question/);
  });
});

describe('POST /api/preparation-plans/generate', () => {
  it('refuses to invent a plan when there is no saved data, and needs consent and configuration', async () => {
    const u = await setup();
    const none = await generate(u);
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('NO_DATA');
    expect(u.llm.generate).not.toHaveBeenCalled();

    const noConsent = await setup({ consent: false, email: 'b@example.com' });
    expect((await generate(noConsent)).status).toBe(403);
    const unconfigured = await setup({ llm: planLlm({ configured: false }), email: 'c@example.com' });
    await seedSession(unconfigured.user.id, [['SQL joins', 20], ['SQL joins', 30]]);
    expect((await generate(unconfigured)).status).toBe(503);
  });

  it('builds the plan from saved results: deterministic items and evidence, AI-written actions', async () => {
    const u = await setup();
    await seedSession(u.user.id, [['SQL joins', 30], ['SQL joins', 40], ['Normalization', 85]]);
    await seedSession(u.user.id, [['SQL joins', 45]]);
    await seedSession(u.user.id, [['Deadlocks', 20]]);
    await seedAnalysis(u.user.id, [req('Docker', 'required', 'none', 0), req('Java', 'required', 'demonstrated', 1)]);

    const res = await generate(u);
    expect(res.status).toBe(201);
    const plan = res.body.data.plan;
    const byKey = Object.fromEntries(plan.items.map((i) => [i.key, i]));

    expect(Object.keys(byKey).sort()).toEqual(['skill_gap:docker', 'watch:deadlocks', 'weak_topic:sql joins']);
    expect(byKey['weak_topic:sql joins']).toMatchObject({ priority: 'high', evidenceType: 'observed_performance', observed: { attempts: 3, average: 38, sessionsBelowThreshold: 2 } });
    expect(byKey['weak_topic:sql joins'].reason).toMatch(/average on "SQL joins" is 38\/100 across 3 answers in 2 interviews/);
    expect(byKey['watch:deadlocks']).toMatchObject({ kind: 'watch', evidenceType: 'limited_evidence' }); // one low answer is NOT called a weakness
    expect(byKey['skill_gap:docker']).toMatchObject({ evidenceType: 'resume_analysis', priority: 'high' });
    expect(byKey['weak_topic:normalization']).toBeUndefined(); // strong topic: nothing recommended
    expect(plan.items.every((i) => i.action && i.practice.length >= 1 && i.completed === false)).toBe(true);
    expect(plan.items[0].priority).toBe('high');
    expect(plan.basis).toMatchObject({ interviewSessions: 3, answeredQuestions: 5, analysisRole: 'Backend Developer' });
    expect(plan.progress).toEqual({ total: 3, completed: 0, percent: 0 });
  });

  it('sends the model only topic names and computed facts, never answers or resume quotes', async () => {
    const u = await setup();
    await seedSession(u.user.id, [['SQL joins', 30], ['SQL joins', 40]]);
    await seedAnalysis(u.user.id, [{ ...req('Docker', 'required', 'none', 0), evidenceQuote: 'SECRET RESUME QUOTE' }]);
    await generate(u);
    const { prompt, systemInstruction } = u.llm.prompts[0];
    expect(prompt).toMatch(/key: weak_topic:sql joins/);
    expect(prompt).toMatch(/Target role: Backend Developer/);
    expect(prompt).not.toMatch(/SECRET ANSWER TEXT|SECRET RESUME QUOTE/);
    expect(systemInstruction).toMatch(/do NOT choose, add, remove or re-rank items/);
  });

  it('does not let the model add, drop or rename items (unknown or missing keys are rejected, nothing saved)', async () => {
    const llm = planLlm();
    const wrong = { items: [{ key: 'weak_topic:sql joins', action: 'Do things carefully.', practice: [{ type: 'task', text: 'Do an exercise now.' }] }, { key: 'weak_topic:invented', action: 'Invented extra item.', practice: [{ type: 'task', text: 'Do something else.' }] }] };
    llm.queue(wrong, wrong);
    const u = await setup({ llm });
    await seedSession(u.user.id, [['SQL joins', 30], ['SQL joins', 40]]);
    const res = await generate(u);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_RESPONSE');
    expect(await PreparationPlan.countDocuments()).toBe(0);
  });

  it('maps provider errors, saves nothing, refunds the quota', async () => {
    const llm = planLlm();
    llm.queue(new AiError(503, 'AI_PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', { retryable: true }));
    const u = await setup({ llm, planQuotaLimit: 1 });
    await seedSession(u.user.id, [['SQL joins', 30], ['SQL joins', 40]]);
    expect((await generate(u)).status).toBe(503);
    expect(await PreparationPlan.countDocuments()).toBe(0);
    expect((await generate(u)).status).toBe(201);
    expect((await generate(u)).status).toBe(429);
  });

  it('links to the USER\'S OWN documents that mention the topic (deterministic text match)', async () => {
    const app = makeRagApp({ llm: planLlm(), embedder: fakeEmbedder() });
    const a = await setup({ app, email: 'a@example.com' });
    const b = await setup({ app, email: 'b@example.com' });
    await seedSession(a.user.id, [['SQL joins', 30], ['SQL joins', 40]]);
    const mk = async (userId, filename, text) => {
      const d = await KnowledgeDocument.create({ userId, filename, sizeBytes: 1, pageCount: 1, charCount: 1, contentHash: filename, status: 'ready' });
      await DocumentChunk.create({ userId, documentId: d._id, chunkIndex: 0, text, textHash: filename, pageStart: 1, pageEnd: 1, embedding: [1], embeddingModel: 'm', embeddingDimensions: 1 });
    };
    await mk(a.user.id, 'my-dbms.pdf', 'An INNER JOIN returns matching rows. Joins are covered here.');
    await mk(a.user.id, 'unrelated.pdf', 'Paging divides memory into frames.');
    await mk(b.user.id, 'bobs-sql-joins.pdf', 'Bob wrote about SQL joins too.');
    const plan = (await generate(a)).body.data.plan;
    expect(plan.items[0].relatedDocuments.map((d) => d.filename)).toEqual(['my-dbms.pdf']);
  });
});

describe('current plan, staleness and completion', () => {
  it('returns null before any plan, flags staleness after new results, and tracks completion', async () => {
    const u = await setup();
    expect((await u.agent.get('/api/preparation-plans/current')).body.data.plan).toBeNull();

    await seedSession(u.user.id, [['SQL joins', 30], ['SQL joins', 40]]);
    await generate(u);
    expect((await u.agent.get('/api/preparation-plans/current')).body.data.plan.stale).toBe(false);

    await new Promise((r) => setTimeout(r, 20));
    await seedSession(u.user.id, [['SQL joins', 35]]); // a new interview finished AFTER the plan was made
    const cur = (await u.agent.get('/api/preparation-plans/current')).body.data.plan;
    expect(cur.stale).toBe(true);

    const done = (await tick(u, 'weak_topic:sql joins', true)).body.data.plan;
    expect(done.progress).toEqual({ total: 1, completed: 1, percent: 100 });
    expect(done.items[0].completedAt).toBeTruthy();
    expect((await tick(u, 'weak_topic:sql joins', false)).body.data.plan.progress.completed).toBe(0);
    expect((await tick(u, 'weak_topic:nope', true)).status).toBe(404);
  });

  it('regeneration updates the plan from new results and reopens a ticked topic that got new low scores', async () => {
    const u = await setup();
    await seedSession(u.user.id, [['SQL joins', 30], ['SQL joins', 40]]);
    await generate(u);
    await tick(u, 'weak_topic:sql joins', true);

    await seedSession(u.user.id, [['SQL joins', 35], ['SQL joins', 25]]);
    const again = (await generate(u)).body.data.plan;
    expect(again.items).toHaveLength(1); // still one current plan, not a second one
    expect(await PreparationPlan.countDocuments()).toBe(1);
    expect(again.items[0]).toMatchObject({ completed: false, observed: { attempts: 4 } });
    expect(again.items[0].reopenedNote).toMatch(/2 more question/);
    expect(again.stale).toBe(false);
  });

  it('is private: another user has their own plan and cannot tick or see it', async () => {
    const app = makeRagApp({ llm: planLlm(), embedder: fakeEmbedder() });
    const a = await setup({ app, email: 'a@example.com' });
    const b = await setup({ app, email: 'b@example.com' });
    await seedSession(a.user.id, [['SQL joins', 30], ['SQL joins', 40]]);
    await generate(a);
    expect((await b.agent.get('/api/preparation-plans/current')).body.data.plan).toBeNull();
    expect((await tick(b, 'weak_topic:sql joins', true)).status).toBe(404);
    expect((await generate(b)).status).toBe(409); // B has no data: A's results are not used
    expect((await request(app).get('/api/preparation-plans/current')).status).toBe(401);
  });
});

describe('GET /api/progress/summary (derived only from saved records)', () => {
  it('is all zeros and empty for a new user: nothing is invented', async () => {
    const u = await setup();
    const p = (await u.agent.get('/api/progress/summary')).body.data;
    expect(p.counts).toEqual({ resumeAnalyses: 0, interviewsCompleted: 0, interviewsInProgress: 0, answeredQuestions: 0, documents: 0 });
    expect([p.matchScores, p.topicAverages, p.needsRevision, p.byCategory, p.recentActivity]).toEqual([[], [], [], [], []]);
    expect(p.plan).toBeNull();
  });

  it('computes counts, scores, topic averages, revision topics, categories, plan progress and activity from the database', async () => {
    const u = await setup();
    await seedAnalysis(u.user.id, [], { score: { overall: 40 } });
    await new Promise((r) => setTimeout(r, 5));
    await seedAnalysis(u.user.id, [], { score: { overall: 65 } });
    await seedSession(u.user.id, [['SQL joins', 30], ['SQL joins', 50], ['Normalization', 90]]);
    await seedSession(u.user.id, [['Deadlocks', 70]], { category: 'Operating systems and computer networks' });
    await seedSession(u.user.id, [], { status: 'in_progress', questions: [] });
    await PreparationPlan.create({ userId: u.user.id, generatedAt: new Date(), items: [{ key: 'a', completed: true }, { key: 'b', completed: false }] });

    const p = (await u.agent.get('/api/progress/summary')).body.data;
    expect(p.counts).toMatchObject({ resumeAnalyses: 2, interviewsCompleted: 2, interviewsInProgress: 1, answeredQuestions: 4 });
    expect(p.matchScores.map((m) => m.score)).toEqual([40, 65]); // chronological
    expect(p.topicAverages.map((t) => [t.topic, t.average, t.attempts])).toEqual([['SQL joins', 40, 2], ['Deadlocks', 70, 1], ['Normalization', 90, 1]]);
    expect(p.needsRevision).toEqual([{ topic: 'SQL joins', average: 40, attempts: 2, repeated: false }]);
    expect(p.byCategory.map((c) => c.category).sort()).toEqual(['DBMS and SQL', 'Operating systems and computer networks']);
    expect(p.plan).toMatchObject({ total: 2, completed: 1, percent: 50 });
    expect(p.recentActivity.length).toBeGreaterThan(0);
    expect(p.recentActivity.every((a, i, arr) => i === 0 || arr[i - 1].date >= a.date)).toBe(true);
  });

  it('filters by interview category and by time window, and validates filters', async () => {
    const u = await setup();
    await seedSession(u.user.id, [['SQL joins', 30]]);
    await seedSession(u.user.id, [['Deadlocks', 70]], { category: 'System design' });
    await seedSession(u.user.id, [['Old topic', 10]], { createdAt: new Date(Date.now() - 200 * 86_400_000) });

    const cat = (await u.agent.get('/api/progress/summary?category=System%20design')).body.data;
    expect(cat.topicAverages.map((t) => t.topic)).toEqual(['Deadlocks']);
    const win = (await u.agent.get('/api/progress/summary?days=30')).body.data;
    expect(win.topicAverages.map((t) => t.topic).sort()).toEqual(['Deadlocks', 'SQL joins']); // the 200-day-old session is excluded
    expect((await u.agent.get('/api/progress/summary?days=all')).body.data.topicAverages).toHaveLength(3);
    expect((await u.agent.get('/api/progress/summary?days=7')).status).toBe(400);
  });

  it('includes quiz results (from graded quizzes only) and application counts by status', async () => {
    const { QuizSession } = await import('../src/models/QuizSession.js');
    const { JobApplication } = await import('../src/models/JobApplication.js');
    const u = await setup();
    const qs = (topic, flags) => flags.map((correct) => ({ question: 'q', options: ['a', 'b', 'c', 'd'], correctIndex: 0, topic, correct }));
    await QuizSession.create({ userId: u.user.id, title: 'one', status: 'completed', completedAt: new Date(), result: { correct: 2, total: 3, percent: 67 }, questions: [...qs('Joins', [true, true]), ...qs('Paging', [false])] });
    await QuizSession.create({ userId: u.user.id, title: 'two', status: 'completed', completedAt: new Date(), result: { correct: 1, total: 2, percent: 50 }, questions: [...qs('Joins', [true]), ...qs('Paging', [false])] });
    await QuizSession.create({ userId: u.user.id, title: 'unfinished', status: 'in_progress', questions: qs('Ignored', [false]) });
    await JobApplication.create([{ userId: u.user.id, company: 'A', roleTitle: 'x', status: 'applied' }, { userId: u.user.id, company: 'B', roleTitle: 'y', status: 'applied' }, { userId: u.user.id, company: 'C', roleTitle: 'z', status: 'offer' }]);

    const p = (await u.agent.get('/api/progress/summary')).body.data;
    expect(p.quizzes.completed).toBe(2);
    expect(p.quizzes.average).toBe(59); // round((67 + 50) / 2)
    expect(p.quizzes.topics).toEqual([{ topic: 'Paging', correct: 0, total: 2, percent: 0 }, { topic: 'Joins', correct: 3, total: 3, percent: 100 }]);
    expect(p.applications).toEqual({ saved: 0, applied: 2, interview: 0, offer: 1, rejected: 0 });
  });

  it("never includes another user's data", async () => {
    const app = makeRagApp({ llm: planLlm(), embedder: fakeEmbedder() });
    const a = await setup({ app, email: 'a@example.com' });
    const b = await setup({ app, email: 'b@example.com' });
    await seedSession(a.user.id, [['SQL joins', 30], ['SQL joins', 40]]);
    await seedAnalysis(a.user.id, []);
    const p = (await b.agent.get('/api/progress/summary')).body.data;
    expect(p.counts.resumeAnalyses + p.counts.answeredQuestions).toBe(0);
    expect(p.topicAverages).toEqual([]);
  });
});
