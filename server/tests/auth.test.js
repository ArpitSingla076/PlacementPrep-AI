import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../src/models/User.js';
import { setupDb, teardownDb, clearDb, makeApp, validUser, registerAgent, ORIGIN } from './helpers.js';

// High limit so the shared app never trips the limiter; the rate-limit test below builds its own strict app.
const app = makeApp({ authRateLimitMax: 10_000 });

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

const cookieHeader = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('pp_session=')) ?? '';

describe('POST /api/auth/register', () => {
  it('creates a user, sets an httpOnly session cookie and never returns the password hash', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({ name: 'Asha Rao', email: 'asha@example.com' });
    expect(res.body.data.csrfToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|correct-horse-1/);
    expect(cookieHeader(res)).toMatch(/HttpOnly/i);
  });

  it('stores a bcrypt hash, not the plain-text password', async () => {
    await request(app).post('/api/auth/register').send(validUser());
    const stored = await User.findOne({ email: 'asha@example.com' }).select('+passwordHash');

    expect(stored.passwordHash).not.toBe('correct-horse-1');
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare('correct-horse-1', stored.passwordHash)).toBe(true);
  });

  it.each([
    ['too short', { password: 'a1' }, 'password'],
    ['no digit', { password: 'onlyletters' }, 'password'],
    ['too long for bcrypt', { password: 'a1'.repeat(40) }, 'password'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['short name', { name: 'A' }, 'name'],
  ])('rejects %s with field-level errors', async (_label, override, field) => {
    const res = await request(app).post('/api/auth/register').send(validUser(override));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  it('rejects unknown fields (mass-assignment attempt)', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...validUser(), tokenVersion: 99, role: 'admin' });
    expect(res.status).toBe(400);
  });

  it('treats emails case-insensitively and rejects duplicates with 409', async () => {
    await request(app).post('/api/auth/register').send(validUser());
    const dup = await request(app).post('/api/auth/register').send(validUser({ email: 'ASHA@Example.com' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
    expect(await User.countDocuments()).toBe(1);
  });

  it('only creates one account when two identical registrations race', async () => {
    const results = await Promise.all([
      request(app).post('/api/auth/register').send(validUser()),
      request(app).post('/api/auth/register').send(validUser()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments()).toBe(1);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validUser());
  });

  it('signs in with correct credentials (email matched case-insensitively)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ASHA@example.com', password: 'correct-horse-1' });
    expect(res.status).toBe(200);
    expect(cookieHeader(res)).toMatch(/HttpOnly/i);
    expect(res.body.data.user.email).toBe('asha@example.com');
  });

  it('gives the identical error for a wrong password and an unknown email (no account enumeration)', async () => {
    const wrongPw = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'wrong-pass-1' });
    const noUser = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-pass-1' });

    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.error).toEqual(noUser.body.error);
    expect(cookieHeader(wrongPw)).toBe('');
  });
});

describe('sessions: GET /api/auth/me, logout, logout-all', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('restores the session from the cookie and re-issues the CSRF token', async () => {
    const { agent, csrfToken } = await registerAgent(app);
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('asha@example.com');
    expect(res.body.data.csrfToken).toBe(csrfToken);
  });

  it('logout clears the cookie', async () => {
    const { agent } = await registerAgent(app);
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a tampered token and a token signed with a different secret', async () => {
    const { user } = await registerAgent(app);
    const forged = jwt.sign({ sub: user.id, csrf: 'x', tv: 0 }, 'a-completely-different-secret-value-123456');
    const res = await request(app).get('/api/auth/me').set('Cookie', `pp_session=${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects an expired token', async () => {
    const { user } = await registerAgent(app);
    const expired = jwt.sign({ sub: user.id, csrf: 'x', tv: 0 }, process.env.JWT_SECRET, { expiresIn: -10 });
    const res = await request(app).get('/api/auth/me').set('Cookie', `pp_session=${expired}`);
    expect(res.status).toBe(401);
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const { user } = await registerAgent(app);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, csrf: 'x', tv: 0 })}.`;
    const res = await request(app).get('/api/auth/me').set('Cookie', `pp_session=${none}`);
    expect(res.status).toBe(401);
  });

  it('logout-all invalidates tokens issued earlier', async () => {
    const { agent, csrfToken, user } = await registerAgent(app);
    // A second "device": log in again, keep that cookie.
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ email: user.email, password: 'correct-horse-1' });
    expect((await other.get('/api/auth/me')).status).toBe(200);

    const res = await agent.post('/api/auth/logout-all').set('X-CSRF-Token', csrfToken);
    expect(res.status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401); // other device is signed out too
  });
});

describe('CSRF and origin protection', () => {
  it('blocks state-changing requests that lack the CSRF header', async () => {
    const { agent } = await registerAgent(app);
    const res = await agent.patch('/api/users/me').send({ name: 'Changed Name' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('blocks a wrong CSRF token and allows the right one', async () => {
    const { agent, csrfToken } = await registerAgent(app);
    const bad = await agent.patch('/api/users/me').set('X-CSRF-Token', 'wrong').send({ name: 'Changed Name' });
    expect(bad.status).toBe(403);
    const good = await agent.patch('/api/users/me').set('X-CSRF-Token', csrfToken).send({ name: 'Changed Name' });
    expect(good.status).toBe(200);
  });

  it('blocks POSTs whose Origin is not the configured frontend', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('allows POSTs from the configured frontend origin', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(401); // reached the handler; credentials are simply wrong
  });
});

describe('PATCH /api/users/me (profile + AI consent)', () => {
  it('updates name, de-duplicated target roles and records AI consent with a timestamp', async () => {
    const { agent, csrfToken } = await registerAgent(app);
    const res = await agent
      .patch('/api/users/me')
      .set('X-CSRF-Token', csrfToken)
      .send({ targetRoles: ['SDE Intern', 'SDE Intern', 'Backend Developer'], aiDataConsent: true });

    expect(res.status).toBe(200);
    expect(res.body.data.user.targetRoles).toEqual(['SDE Intern', 'Backend Developer']);
    expect(res.body.data.user.preferences.aiDataConsent.given).toBe(true);
    expect(res.body.data.user.preferences.aiDataConsent.givenAt).toBeTruthy();
  });

  it('validates input and cannot be used to change protected fields', async () => {
    const { agent, csrfToken } = await registerAgent(app);
    const tooMany = await agent.patch('/api/users/me').set('X-CSRF-Token', csrfToken).send({ targetRoles: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(tooMany.status).toBe(400);
    const sneaky = await agent.patch('/api/users/me').set('X-CSRF-Token', csrfToken).send({ passwordHash: 'x', email: 'evil@example.com' });
    expect(sneaky.status).toBe(400);
    const empty = await agent.patch('/api/users/me').set('X-CSRF-Token', csrfToken).send({});
    expect(empty.status).toBe(400);
  });

  it("isolates users: one user's update never touches another user's record", async () => {
    const a = await registerAgent(app, { email: 'a@example.com', name: 'User A' });
    const b = await registerAgent(app, { email: 'b@example.com', name: 'User B' });

    await a.agent.patch('/api/users/me').set('X-CSRF-Token', a.csrfToken).send({ name: 'A Renamed' });

    const bMe = await b.agent.get('/api/auth/me');
    expect(bMe.body.data.user.name).toBe('User B');
    expect((await User.findOne({ email: 'a@example.com' })).name).toBe('A Renamed');
  });
});

describe('platform behaviour', () => {
  it('returns JSON 404 for unknown routes and 400 for malformed JSON', async () => {
    const nf = await request(app).get('/api/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');

    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
  });

  it('health endpoint reports database status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('applies a global per-IP API limit (but never to /health)', async () => {
    const limited = makeApp({ apiRateLimitMax: 3, authRateLimitMax: 10_000 });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(limited).get('/api/auth/me')).status);
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    const blocked = await request(limited).get('/api/auth/me');
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect((await request(limited).get('/api/health')).status).toBe(200); // monitors still get through
  });

  it('rate-limits repeated auth attempts', async () => {
    const limited = makeApp({ authRateLimitMax: 3 });
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await request(limited).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' })).status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});
