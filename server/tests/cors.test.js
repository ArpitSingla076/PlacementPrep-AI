import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { loadEnv, parseOrigins } from '../src/config/env.js';
import { makeApp } from './helpers.js';

const ORIGIN = 'http://localhost:5173'; // CLIENT_URL in the test environment
const EVIL = 'https://evil.example';

describe('the app starts (regression: an invalid route pattern once crashed the server on boot)', () => {
  it('builds without throwing, repeatedly', () => {
    expect(() => makeApp()).not.toThrow();
    expect(() => makeApp({ authRateLimitMax: 5, apiRateLimitMax: 5 })).not.toThrow();
  });
});

describe('CORS preflight (the OPTIONS request a browser sends before a cross-site POST/PATCH/DELETE)', () => {
  const app = makeApp();
  const preflight = (path, origin = ORIGIN) =>
    request(app).options(path).set('Origin', origin).set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,x-csrf-token');

  it('allows the configured frontend, with credentials and the CSRF header', async () => {
    const res = await preflight('/api/auth/register');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toMatch(/x-csrf-token/i);
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
    expect(res.headers.vary).toMatch(/Origin/i);
  });

  it('answers preflights for every kind of route, including unknown ones (no per-route setup needed)', async () => {
    for (const path of ['/api/auth/login', '/api/documents/abc', '/api/chat/ask', '/api/job-analyses/compare', '/api/users/me', '/api/does-not-exist']) {
      const res = await preflight(path);
      expect(res.headers['access-control-allow-origin'], path).toBe(ORIGIN);
    }
  });

  it('refuses any other website: no CORS headers, so the browser blocks the call', async () => {
    const res = await preflight('/api/auth/register', EVIL);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('adds CORS headers to real responses only for the allowed origin, and lets requests with no Origin through', async () => {
    expect((await request(app).get('/api/health').set('Origin', ORIGIN)).headers['access-control-allow-origin']).toBe(ORIGIN);
    expect((await request(app).get('/api/health').set('Origin', EVIL)).headers['access-control-allow-origin']).toBeUndefined();
    expect([200, 503]).toContain((await request(app).get('/api/health')).status); // curl / uptime monitors
  });

  it('shows which origins are allowed on the health URL (the first thing to check when the browser says "blocked by CORS")', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.data.allowedOrigins).toEqual([ORIGIN]);
  });

  it('still blocks state-changing requests from other sites with a clear JSON error, even without CORS', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', EVIL).send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(res.body.error.message).toMatch(/CLIENT_URL/);
  });
});

describe('CLIENT_URL parsing is forgiving about copy-paste mistakes', () => {
  it.each([
    ['https://my-app.vercel.app', ['https://my-app.vercel.app']],
    ['https://my-app.vercel.app/', ['https://my-app.vercel.app']],
    ['"https://my-app.vercel.app"', ['https://my-app.vercel.app']],
    ["  'https://my-app.vercel.app/'  ", ['https://my-app.vercel.app']],
    ['https://my-app.vercel.app/register?x=1#y', ['https://my-app.vercel.app']],
    ['HTTPS://My-App.Vercel.App', ['https://my-app.vercel.app']],
    ['https://a.app, https://www.a.app', ['https://a.app', 'https://www.a.app']],
    ['https://a.app,https://a.app/', ['https://a.app']],
    ['http://localhost:5173', ['http://localhost:5173']],
  ])('%s', (input, expected) => {
    expect(parseOrigins(input)).toEqual(expected);
  });

  it.each(['', '   ', ',', 'my-app.vercel.app', 'ftp://files.example', 'javascript:alert(1)', 'https://'])('rejects %j with a message naming CLIENT_URL', (bad) => {
    expect(() => parseOrigins(bad)).toThrow(/CLIENT_URL/);
  });

  it('is exposed through loadEnv as CLIENT_ORIGINS, and a bad value fails at startup with a readable message', () => {
    const base = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 'x'.repeat(40) };
    expect(loadEnv({ ...base, CLIENT_URL: '"https://a.app/", https://b.app' }).CLIENT_ORIGINS).toEqual(['https://a.app', 'https://b.app']);
    expect(loadEnv(base).CLIENT_ORIGINS).toEqual(['http://localhost:5173']);
    expect(() => loadEnv({ ...base, CLIENT_URL: 'not a url' })).toThrow(/CLIENT_URL.*not a valid http\(s\) address/s);
  });
});
