import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GeminiEmbeddingProvider } from '../src/ai/providers/geminiEmbedding.js';
import { startFakeGemini, errBody, embedBody } from './fakeGemini.js';

let fake;
beforeAll(async () => { fake = await startFakeGemini(); });
afterAll(() => fake.close());
beforeEach(() => fake.reset());

const make = (over = {}) => new GeminiEmbeddingProvider({
  apiKey: 'test-key-1234567890-not-real', model: 'fake-embed', baseUrl: fake.url, timeoutMs: 3000,
  retries: 2, retryBaseMs: 1, sleep: async () => {}, ...over,
});
const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('GeminiEmbeddingProvider (real SDK against a Gemini-format fake)', () => {
  it('sends one Content per text, the task type, and the output dimensionality; returns unit-length vectors', async () => {
    fake.reply({ body: embedBody(3, 8) });
    const out = await make({ dimensions: 8 }).embed({ texts: ['a', 'b', 'c'], kind: 'document' });

    expect(out).toHaveLength(3);
    for (const v of out) { expect(v).toHaveLength(8); expect(norm(v)).toBeCloseTo(1, 6); } // we normalise: the fake returned [2,2,...]
    const req = fake.state.requests[0];
    expect(req.url).toMatch(/models\/fake-embed:batchEmbedContents$/);
    expect(req.headers['x-goog-api-key']).toBeTruthy();
    expect(req.body.requests).toHaveLength(3);
    expect(req.body.requests.map((r) => r.content.parts[0].text)).toEqual(['a', 'b', 'c']);
    expect(req.body.requests[0].taskType).toBe('RETRIEVAL_DOCUMENT');
    expect(req.body.requests[0].outputDimensionality).toBe(8);
  });

  it('uses RETRIEVAL_QUERY for questions, and omits taskType/dimensions when not configured', async () => {
    fake.reply({ body: embedBody(1) }, { body: embedBody(1) });
    await make().embed({ texts: ['q'], kind: 'query' });
    await make({ useTaskType: false }).embed({ texts: ['q'], kind: 'query' });
    expect(fake.state.requests[0].body.requests[0].taskType).toBe('RETRIEVAL_QUERY');
    expect(fake.state.requests[0].body.requests[0].outputDimensionality).toBeUndefined();
    expect(fake.state.requests[1].body.requests[0].taskType).toBeUndefined();
  });

  it('splits large inputs into batches', async () => {
    fake.reply({ body: embedBody(2) }, { body: embedBody(2) }, { body: embedBody(1) });
    const out = await make({ batchSize: 2 }).embed({ texts: ['1', '2', '3', '4', '5'] });
    expect(out).toHaveLength(5);
    expect(fake.state.requests.map((r) => r.body.requests.length)).toEqual([2, 2, 1]);
  });

  it('fails loudly if the API merges inputs (wrong number of vectors) instead of mis-assigning vectors to chunks', async () => {
    fake.reply({ body: embedBody(1) });
    await expect(make().embed({ texts: ['a', 'b', 'c'] })).rejects.toMatchObject({ code: 'AI_EMBEDDING_COUNT_MISMATCH' });
  });

  it('fails if the dimension differs from EMBEDDING_DIMENSIONS (a mismatch would silently break the vector index)', async () => {
    fake.reply({ body: embedBody(1, 16) });
    const err = await make({ dimensions: 8 }).embed({ texts: ['a'] }).catch((e) => e);
    expect(err.code).toBe('AI_EMBEDDING_DIMENSION_MISMATCH');
    expect(err.message).toMatch(/16 dimensions.*8/);
  });

  it('retries transient errors with a bound, and maps permanent ones', async () => {
    fake.reply({ status: 429, body: errBody(429, 'RESOURCE_EXHAUSTED', 'x') }, { body: embedBody(1) });
    expect(await make().embed({ texts: ['a'] })).toHaveLength(1);
    expect(fake.state.requests).toHaveLength(2);

    fake.reset();
    fake.reply(...Array(5).fill({ status: 503, body: errBody(503, 'UNAVAILABLE', 'x') }));
    await expect(make({ retries: 1 }).embed({ texts: ['a'] })).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(fake.state.requests).toHaveLength(2);

    fake.reset();
    fake.reply({ status: 404, body: errBody(404, 'NOT_FOUND', 'x') });
    await expect(make().embed({ texts: ['a'] })).rejects.toMatchObject({ code: 'AI_MODEL_UNAVAILABLE' });
    expect(fake.state.requests).toHaveLength(1);
  });

  it('refuses to call out when not configured', async () => {
    await expect(make({ model: undefined }).embed({ texts: ['a'] })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fake.state.requests).toHaveLength(0);
  });
});
