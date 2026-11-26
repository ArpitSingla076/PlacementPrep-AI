import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseConnection } from '../src/utils/connectionDiagnosis.js';

const ORIGIN = 'https://site.vercel.app';
const DIRECT_API = 'https://api.onrender.com/api';
const okJson = (origins = [ORIGIN]) => ({ reached: true, status: 200, json: { success: true, data: { status: 'ok', allowedOrigins: origins } } });
const down = { reached: false };
const reachedOpaque = { reached: true, opaque: true };
const html404 = { reached: true, status: 404, json: null };
const run = (o) => diagnoseConnection({ origin: ORIGIN, api: DIRECT_API, ...o });

test('direct mode, everything works', () => {
  assert.equal(run({ direct: okJson(), noCors: reachedOpaque, proxy: okJson() }).tone, 'ok');
});

test('direct mode broken because the browser cannot connect at all, but same-site works: tells you to switch', () => {
  const d = run({ direct: down, noCors: down, proxy: okJson() });
  assert.equal(d.tone, 'warn');
  assert.match(d.tips.join(' '), /delete VITE_API_URL/);
  assert.match(d.tips.join(' '), /cannot connect to the server directly/);
});

test('direct mode broken by missing CORS headers (server reachable), same-site works: tells you to switch', () => {
  const d = run({ direct: down, noCors: reachedOpaque, proxy: okJson() });
  assert.equal(d.tone, 'warn');
  assert.match(d.tips.join(' '), /CORS permission is missing/);
  assert.match(d.tips.join(' '), /delete VITE_API_URL/);
});

test('direct mode, reachable but unreadable, and same-site also fails: points at Render logs and CORS', () => {
  const d = run({ direct: down, noCors: reachedOpaque, proxy: html404 });
  assert.equal(d.tone, 'bad');
  assert.match(d.title, /not readable/);
  assert.match(d.tips.join(' '), /origin=https:\/\/site\.vercel\.app/);
});

test('nothing reaches the server by any path: suggests the phone / other-network test', () => {
  const d = run({ direct: down, noCors: down, proxy: down });
  assert.equal(d.tone, 'bad');
  assert.match(d.title, /cannot reach the server at all/);
  assert.match(d.tips.join(' '), /mobile data/);
});

test('a reply that is not the app (for example a hosting 404 page) is called out', () => {
  const d = run({ direct: html404, noCors: reachedOpaque, proxy: down });
  assert.equal(d.tone, 'bad');
  assert.match(d.title, /not this app/);
});

test('the server is up but this website is not in its allowed list: names the exact CLIENT_URL to set', () => {
  const d = run({ direct: okJson(['http://localhost:5173']), noCors: reachedOpaque, proxy: down });
  assert.equal(d.tone, 'bad');
  assert.match(d.title, /does not allow this website/);
  assert.match(d.tips.join(' '), /set CLIENT_URL to https:\/\/site\.vercel\.app/);
});

test('the server is up but the database is not', () => {
  const d = run({ direct: { reached: true, status: 503, json: { success: false, data: { status: 'database_unavailable', allowedOrigins: [ORIGIN] } } }, noCors: reachedOpaque, proxy: down });
  assert.equal(d.tone, 'warn');
  assert.match(d.title, /database/);
});

test('same-site mode (API is /api): works, and fails with a pointer to vercel.json', () => {
  assert.equal(run({ api: '/api', direct: okJson(), noCors: undefined, proxy: okJson() }).tone, 'ok');
  const bad = run({ api: '/api', direct: html404, noCors: undefined, proxy: html404 });
  assert.equal(bad.tone, 'bad');
  assert.match(bad.tips.join(' '), /vercel\.json/);
});

test('always reports three checks', () => {
  const d = run({ direct: down, noCors: down, proxy: down });
  assert.equal(d.checks.length, 3);
  assert.deepEqual(d.checks.map((c) => c.state), ['fail', 'fail', 'fail']);
});
