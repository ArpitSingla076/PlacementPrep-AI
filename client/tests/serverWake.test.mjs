import test from 'node:test';
import assert from 'node:assert/strict';
import { retryWhileWaking, serverNotReady } from '../src/utils/serverWake.js';

const http = (status) => Object.assign(new Error('http ' + status), { response: { status } });
const noReply = () => Object.assign(new Error('Network Error'), { request: {} });
const instant = async () => {};

test('no reply and platform error pages count as "server not ready"; genuine app answers do not', () => {
  for (const err of [noReply(), http(404), http(502), http(503), http(504), http(408)]) assert.equal(serverNotReady(err), true);
  for (const err of [http(400), http(401), http(403), http(409), http(422), http(429), http(500)]) assert.equal(serverNotReady(err), false);
});

test('keeps trying while the server wakes, then returns the real answer', async () => {
  let calls = 0;
  const waits = [];
  const result = await retryWhileWaking(async () => { calls++; if (calls < 4) throw calls % 2 ? noReply() : http(404); return 'user'; }, { sleep: instant, onWait: (n) => waits.push(n) });
  assert.equal(result, 'user');
  assert.equal(calls, 4);
  assert.deepEqual(waits, [1, 2, 3]);
});

test('a real answer such as 401 (not signed in) is final: no retries', async () => {
  let calls = 0;
  await assert.rejects(retryWhileWaking(async () => { calls++; throw http(401); }, { sleep: instant }), (e) => e.response.status === 401);
  assert.equal(calls, 1);
});

test('gives up after the configured number of attempts and reports the last error', async () => {
  let calls = 0;
  await assert.rejects(retryWhileWaking(async () => { calls++; throw http(503); }, { attempts: 5, sleep: instant }), (e) => e.response.status === 503);
  assert.equal(calls, 5);
});

test('waits the configured delay between attempts', async () => {
  const delays = [];
  await assert.rejects(retryWhileWaking(async () => { throw noReply(); }, { attempts: 3, delayMs: 1234, sleep: async (ms) => { delays.push(ms); } }));
  assert.deepEqual(delays, [1234, 1234]);
});
