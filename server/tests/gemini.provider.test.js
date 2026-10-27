import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { z } from 'zod';
import { GeminiLlmProvider } from '../src/ai/providers/gemini.js';
import { generateStructured } from '../src/ai/structured.js';
import { toProviderJsonSchema } from '../src/ai/jsonSchema.js';
import { startFakeGemini, okBody, errBody } from './fakeGemini.js';

let fake;
beforeAll(async () => { fake = await startFakeGemini(); });
afterAll(() => fake.close());
beforeEach(() => fake.reset());

const KEY = 'test-key-1234567890-not-real';
const make = (over = {}) =>
  new GeminiLlmProvider({ apiKey: KEY, model: 'test-model', baseUrl: fake.url, timeoutMs: 3000, maxOutputTokens: 4096, ...over });
const call = (p, over = {}) =>
  p.generate({ systemInstruction: 'SYS', messages: [{ role: 'user', text: 'hello' }], jsonSchema: { type: 'object', properties: { a: { type: 'string' } } }, ...over });
const noSleep = async () => {};

describe('GeminiLlmProvider: request shape (real SDK -> fake Gemini wire format)', () => {
  it('sends the model in the URL, the key in a header, and the config in the body - never the key in URL/body', async () => {
    fake.reply({ body: okBody('{"a":"x"}') });
    const res = await call(make(), { temperature: 0.1 });

    expect(res.text).toBe('{"a":"x"}');
    expect(res.usage).toEqual({ promptTokens: 100, outputTokens: 50, totalTokens: 150 });
    const req = fake.state.requests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toMatch(/\/models\/test-model:generateContent$/);
    expect(req.headers['x-goog-api-key']).toBe(KEY);
    expect(req.url).not.toContain(KEY);
    expect(JSON.stringify(req.body)).not.toContain(KEY);

    expect(req.body.systemInstruction.parts[0].text).toBe('SYS');
    expect(req.body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    const cfg = req.body.generationConfig;
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.responseJsonSchema).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
    expect(cfg.temperature).toBe(0.1);
    expect(cfg.maxOutputTokens).toBe(4096);
    expect(cfg.thinkingConfig).toBeUndefined(); // not sent unless configured
  });

  it('sends thinkingConfig only when configured (budget or level)', async () => {
    fake.reply({ body: okBody('{}') }, { body: okBody('{}') });
    await call(make({ thinkingBudget: 0 }));
    await call(make({ thinkingLevel: 'low' }));
    expect(fake.state.requests[0].body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(fake.state.requests[1].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('refuses to call out when not configured (no API key / no model) and makes no HTTP request', async () => {
    for (const p of [make({ apiKey: undefined }), make({ model: undefined })]) {
      await expect(call(p)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', status: 503 });
    }
    expect(fake.state.requests).toHaveLength(0);
  });
});

describe('GeminiLlmProvider: error mapping (one HTTP request each => SDK built-in retries are disabled)', () => {
  it.each([
    [429, 'RESOURCE_EXHAUSTED', 'AI_RATE_LIMITED', 429, true],
    [500, 'INTERNAL', 'AI_PROVIDER_UNAVAILABLE', 503, true],
    [503, 'UNAVAILABLE', 'AI_PROVIDER_UNAVAILABLE', 503, true],
    [403, 'PERMISSION_DENIED', 'AI_AUTH_FAILED', 502, false],
    [401, 'UNAUTHENTICATED', 'AI_AUTH_FAILED', 502, false],
    [404, 'NOT_FOUND', 'AI_MODEL_UNAVAILABLE', 502, false],
    [400, 'INVALID_ARGUMENT', 'AI_BAD_REQUEST', 502, false],
  ])('HTTP %i %s -> %s', async (httpStatus, status, code, mappedStatus, retryable) => {
    fake.reply({ status: httpStatus, body: errBody(httpStatus, status, 'provider detail that must not leak') });
    const err = await call(make()).catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.status).toBe(mappedStatus);
    expect(err.retryable).toBe(retryable);
    expect(err.message).not.toMatch(/provider detail/); // raw provider text is never forwarded
    expect(fake.state.requests).toHaveLength(1);
  });

  it('extracts the suggested wait from a 429 (retryDelay) and tells the user', async () => {
    fake.reply({ status: 429, body: errBody(429, 'RESOURCE_EXHAUSTED', 'quota', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }]) });
    const err = await call(make()).catch((e) => e);
    expect(err.retryAfterMs).toBe(34_000);
    expect(err.message).toMatch(/34 seconds/);
  });

  it('times out slow responses', async () => {
    fake.reply({ delayMs: 1500, body: okBody('{}') });
    const err = await call(make({ timeoutMs: 200 })).catch((e) => e);
    expect(err.code).toBe('AI_TIMEOUT');
    expect(err.retryable).toBe(true);
  });

  it('maps network failure (nothing listening) to AI_PROVIDER_UNAVAILABLE', async () => {
    const err = await call(make({ baseUrl: 'http://127.0.0.1:9' })).catch((e) => e);
    expect(err.code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(err.retryable).toBe(true);
  });

  it('handles blocked and empty responses', async () => {
    fake.reply({ body: { promptFeedback: { blockReason: 'SAFETY' } } });
    expect(await call(make()).catch((e) => e)).toMatchObject({ code: 'AI_BLOCKED' });

    fake.reply({ body: { candidates: [{ finishReason: 'SAFETY', index: 0 }] } });
    expect(await call(make()).catch((e) => e)).toMatchObject({ code: 'AI_BLOCKED' });

    fake.reply({ body: { candidates: [] } });
    expect(await call(make()).catch((e) => e)).toMatchObject({ code: 'AI_EMPTY_RESPONSE' });
  });
});

describe('toProviderJsonSchema', () => {
  it('keeps only keywords Gemini supports and preserves property names', () => {
    const schema = z.object({
      title: z.string().max(50),
      level: z.enum(['a', 'b']),
      items: z.array(z.object({ note: z.string().min(1).max(10) })).max(3),
    });
    const out = toProviderJsonSchema(schema);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/maxLength|minLength|\$schema|pattern|default/);
    expect(out.type).toBe('object');
    expect(Object.keys(out.properties)).toEqual(['title', 'level', 'items']);
    expect(out.properties.level.enum).toEqual(['a', 'b']);
    expect(JSON.stringify(out)).not.toMatch(/maxItems|minItems/); // list sizes are enforced by Zod, not sent to Gemini
    expect(out.required).toEqual(['title', 'level', 'items']);
  });
});

describe('generateStructured: retries, repair and validation', () => {
  const schema = z.object({ answer: z.string().min(1) }).strict();
  const run = (over = {}) =>
    generateStructured({ provider: make(), systemInstruction: 'SYS', userPrompt: 'Q', schema, retryBaseMs: 1, sleep: noSleep, ...over });

  it('returns validated data and token usage', async () => {
    fake.reply({ body: okBody('{"answer":"ok"}', { usage: [10, 5] }) });
    const r = await run();
    expect(r).toMatchObject({ data: { answer: 'ok' }, repaired: false, model: 'test-model' });
    expect(r.usage.totalTokens).toBe(15);
  });

  it('retries a transient 503 then succeeds (bounded)', async () => {
    fake.reply({ status: 503, body: errBody(503, 'UNAVAILABLE', 'x') }, { body: okBody('{"answer":"ok"}') });
    expect((await run()).data.answer).toBe('ok');
    expect(fake.state.requests).toHaveLength(2);
  });

  it('gives up after AI_MAX_RETRIES and reports the provider error', async () => {
    fake.reply(...Array(5).fill({ status: 503, body: errBody(503, 'UNAVAILABLE', 'x') }));
    await expect(run({ retries: 2 })).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(fake.state.requests).toHaveLength(3); // 1 attempt + 2 retries, never more
  });

  it('does not retry non-retryable errors (bad key)', async () => {
    fake.reply({ status: 403, body: errBody(403, 'PERMISSION_DENIED', 'x') });
    await expect(run()).rejects.toMatchObject({ code: 'AI_AUTH_FAILED' });
    expect(fake.state.requests).toHaveLength(1);
  });

  it('does not wait out a long rate-limit (e.g. exhausted daily quota): fails fast with a clear message', async () => {
    fake.reply({ status: 429, body: errBody(429, 'RESOURCE_EXHAUSTED', 'q', [{ retryDelay: '3600s' }]) });
    await expect(run()).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(fake.state.requests).toHaveLength(1);
  });

  it('repairs invalid output once: the second request contains the model output and the validation errors', async () => {
    fake.reply({ body: okBody('{"answer":""}') }, { body: okBody('{"answer":"fixed"}') });
    const r = await run();
    expect(r.repaired).toBe(true);
    expect(r.data.answer).toBe('fixed');
    const second = fake.state.requests[1].body.contents;
    expect(second.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(second[2].parts[0].text).toMatch(/failed validation/);
    expect(second[2].parts[0].text).toMatch(/answer/);
  });

  it('fails with AI_INVALID_RESPONSE when the repair is also invalid (never returns unvalidated data)', async () => {
    fake.reply({ body: okBody('not json at all') }, { body: okBody('{"wrong":1}') });
    await expect(run()).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', status: 502 });
    expect(fake.state.requests).toHaveLength(2);
  });

  it('rejects unknown keys (strict schema) - e.g. a model that tries to inject its own "score"', async () => {
    fake.reply({ body: okBody('{"answer":"a","score":100}') }, { body: okBody('{"answer":"a","score":100}') });
    await expect(run()).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  it('accepts JSON wrapped in a markdown code fence', async () => {
    fake.reply({ body: okBody('```json\n{"answer":"ok"}\n```') });
    expect((await run()).data.answer).toBe('ok');
  });

  it('reports truncation (MAX_TOKENS) without wasting a repair call', async () => {
    fake.reply({ body: okBody('{"answer":"cut o', { finishReason: 'MAX_TOKENS' }) });
    await expect(run()).rejects.toMatchObject({ code: 'AI_TRUNCATED' });
    expect(fake.state.requests).toHaveLength(1);
  });

  it('is not-configured aware before any network call', async () => {
    await expect(run({ provider: make({ apiKey: undefined }) })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fake.state.requests).toHaveLength(0);
  });
});
