import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { JobApplication } from '../src/models/JobApplication.js';
import { JobAnalysis } from '../src/models/JobAnalysis.js';
import { diffAnalyses } from '../src/services/analysis/compare.js';
import { setupDb, teardownDb, clearDb, makeRagApp, registerAgent } from './helpers.js';
import { ragLlm, fakeEmbedder } from './fixtures.js';

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

const app = makeRagApp({ llm: ragLlm(), embedder: fakeEmbedder() });
const setup = (email = 'asha@example.com') => registerAgent(app, { email });
const post = (u, body) => u.agent.post('/api/applications').set('X-CSRF-Token', u.csrfToken).send(body);
const patch = (u, id, body) => u.agent.patch(`/api/applications/${id}`).set('X-CSRF-Token', u.csrfToken).send(body);
const del = (u, id) => u.agent.delete(`/api/applications/${id}`).set('X-CSRF-Token', u.csrfToken);
const req = (skill, credit, importance = 'required', weight = 3) => ({ skill, importance, weight, credit, evidenceLevel: credit === 1 ? 'demonstrated' : credit ? 'listed' : 'none', category: 'tool' });
const analysis = (userId, requirements, overall, role = 'Backend Developer') => JobAnalysis.create({ userId, resumeId: userId, roleTitle: role, resumeFilename: 'r.pdf', jobDescription: 'x', inputHash: String(Math.random()), requirements, score: { overall } });

describe('application tracker', () => {
  it('creates, lists (newest update first), updates and deletes', async () => {
    const u = await setup();
    const a = (await post(u, { company: 'Acme', roleTitle: 'SDE Intern', jobUrl: 'https://acme.com/jobs/1', notes: 'Referral from Ravi', location: 'Pune', deadline: '2026-12-01' })).body.data.application;
    expect(a).toMatchObject({ company: 'Acme', roleTitle: 'SDE Intern', status: 'saved', location: 'Pune', analysis: null });
    expect(a.userId).toBeUndefined();
    expect(a.statusHistory).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 10));
    const b = (await post(u, { company: 'Globex', roleTitle: 'Backend Dev' })).body.data.application;

    expect((await u.agent.get('/api/applications')).body.data.applications.map((x) => x.company)).toEqual(['Globex', 'Acme']);
    await new Promise((r) => setTimeout(r, 10));
    expect((await patch(u, a.id, { notes: 'Updated' })).body.data.application.notes).toBe('Updated');
    expect((await u.agent.get('/api/applications')).body.data.applications[0].company).toBe('Acme'); // touched most recently

    expect((await del(u, b.id)).status).toBe(200);
    expect(await JobApplication.countDocuments()).toBe(1);
  });

  it('records status history, sets appliedAt when first moved to "applied", and lets optional fields be cleared with null', async () => {
    const u = await setup();
    const a = (await post(u, { company: 'Acme', roleTitle: 'Dev', notes: 'temp' })).body.data.application;
    const applied = (await patch(u, a.id, { status: 'applied' })).body.data.application;
    expect(applied.appliedAt).toBeTruthy();
    const firstApplied = applied.appliedAt;
    await patch(u, a.id, { status: 'interview' });
    const back = (await patch(u, a.id, { status: 'applied' })).body.data.application;
    expect(back.appliedAt).toBe(firstApplied); // not overwritten
    expect(back.statusHistory.map((h) => h.status)).toEqual(['saved', 'applied', 'interview', 'applied']);
    expect((await patch(u, a.id, { notes: null })).body.data.application.notes).toBeUndefined();
  });

  it('validates input: only http(s) links (no javascript: URLs), status values, lengths, unknown fields, empty updates', async () => {
    const u = await setup();
    for (const bad of [
      { company: '', roleTitle: 'x' }, { company: 'A', roleTitle: '' }, { company: 'A', roleTitle: 'B', status: 'ghosted' },
      { company: 'A', roleTitle: 'B', jobUrl: 'javascript:alert(1)' }, { company: 'A', roleTitle: 'B', jobUrl: 'not a url' },
      { company: 'A', roleTitle: 'B', deadline: 'someday' }, { company: 'A', roleTitle: 'B', notes: 'x'.repeat(2001) }, { company: 'A', roleTitle: 'B', userId: 'x' },
    ]) expect((await post(u, bad)).status, JSON.stringify(bad)).toBe(400);
    const a = (await post(u, { company: 'A', roleTitle: 'B' })).body.data.application;
    expect((await patch(u, a.id, {})).status).toBe(400);
    expect((await patch(u, a.id, { status: 'nope' })).status).toBe(400);
    expect((await patch(u, a.id, { _id: 'x' })).status).toBe(400);
  });

  it('links an analysis the user owns and shows its score; rejects someone else\'s', async () => {
    const a = await setup('a@example.com'); const b = await setup('b@example.com');
    const mine = await analysis(a.user.id, [], 72, 'Platform Engineer');
    const theirs = await analysis(b.user.id, [], 10);
    const app1 = (await post(a, { company: 'Acme', roleTitle: 'Dev', jobAnalysisId: String(mine._id) })).body.data.application;
    expect(app1.analysis).toEqual({ id: String(mine._id), roleTitle: 'Platform Engineer', score: 72 });
    expect((await post(a, { company: 'X', roleTitle: 'Y', jobAnalysisId: String(theirs._id) })).status).toBe(404);
    const c = (await post(a, { company: 'C', roleTitle: 'D' })).body.data.application;
    expect((await patch(a, c.id, { jobAnalysisId: String(theirs._id) })).status).toBe(404);
    expect((await patch(a, c.id, { jobAnalysisId: String(mine._id) })).status).toBe(200);
  });

  it("is private: other users cannot list, edit or delete someone's applications, and ids are checked", async () => {
    const a = await setup('a@example.com'); const b = await setup('b@example.com');
    const id = (await post(a, { company: 'Secret Co', roleTitle: 'Dev' })).body.data.application.id;
    expect((await b.agent.get('/api/applications')).body.data.applications).toEqual([]);
    expect((await patch(b, id, { notes: 'hacked' })).status).toBe(404);
    expect((await del(b, id)).status).toBe(404);
    expect((await patch(b, 'not-an-id', { notes: 'x' })).status).toBe(404);
    expect((await del(b, 'not-an-id')).status).toBe(404);
    expect((await JobApplication.findById(id)).notes).toBeUndefined();
    expect((await request(app).get('/api/applications')).status).toBe(401);
    expect((await a.agent.post('/api/applications').send({ company: 'A', roleTitle: 'B' })).status).toBe(403); // CSRF
  });
});

describe('comparing analyses', () => {
  it('computes the deterministic difference per skill', () => {
    const doc = (overall, reqs) => ({ score: { overall }, requirements: reqs });
    const a = doc(40, [req('Java', 0.5), req('SQL', 1), req('Docker', 0, 'preferred', 2), req('Redis', 0.25, 'bonus', 1)]);
    const b = doc(61, [req('java', 1), req('SQL', 1), req('Docker', 0, 'preferred', 2), req('AWS', 0, 'preferred', 2), req('Redis', 0, 'bonus', 1)]);
    const { summary, skills } = diffAnalyses(a, b);
    expect(summary).toEqual({ scoreA: 40, scoreB: 61, delta: 21, improved: 1, declined: 1, same: 2, onlyA: 0, onlyB: 1 });
    const by = Object.fromEntries(skills.map((s) => [s.skill.toLowerCase(), s.change]));
    expect(by).toEqual({ java: 'improved', redis: 'declined', aws: 'only_b', sql: 'same', docker: 'same' });
    expect(skills.map((s) => s.change)).toEqual(['improved', 'declined', 'only_b', 'same', 'same']); // most interesting first
  });

  it('GET /compare returns both reports\' metadata and the diff, and rejects same ids, unknown ids and other users\' reports', async () => {
    const a = await setup('a@example.com'); const b = await setup('b@example.com');
    const one = await analysis(a.user.id, [req('Java', 0.5)], 30);
    const two = await analysis(a.user.id, [req('Java', 1)], 80);
    const theirs = await analysis(b.user.id, [req('Java', 1)], 99);

    const res = await a.agent.get(`/api/job-analyses/compare?a=${one._id}&b=${two._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.comparison).toMatchObject({ a: { id: String(one._id), score: 30 }, b: { id: String(two._id), score: 80 }, summary: { delta: 50, improved: 1 } });
    expect((await a.agent.get(`/api/job-analyses/compare?a=${one._id}&b=${one._id}`)).status).toBe(400);
    expect((await a.agent.get(`/api/job-analyses/compare?a=${one._id}&b=${theirs._id}`)).status).toBe(404);
    expect((await a.agent.get(`/api/job-analyses/compare?a=${one._id}&b=nope`)).status).toBe(404);
    expect((await a.agent.get(`/api/job-analyses/compare?a=${one._id}`)).status).toBe(400);
    expect((await request(app).get(`/api/job-analyses/compare?a=${one._id}&b=${two._id}`)).status).toBe(401);
    // the existing report route still works (compare is registered before /:id)
    expect((await a.agent.get(`/api/job-analyses/${one._id}`)).status).toBe(200);
  });
});
