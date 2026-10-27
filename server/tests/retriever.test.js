import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { DocumentChunk } from '../src/models/DocumentChunk.js';
import { buildVectorSearchPipeline, vectorIndexDefinition, AtlasRetriever, LocalRetriever } from '../src/ai/rag/retriever.js';
import { supportScore } from '../src/ai/rag/support.js';
import { setupDb, teardownDb, clearDb } from './helpers.js';
import { hashEmbed } from './fakeEmbedding.js';

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

const { ObjectId } = mongoose.Types;
const { BSON } = mongoose.mongo;

describe('buildVectorSearchPipeline (Atlas $vectorSearch)', () => {
  const userId = new ObjectId().toString();
  const docs = [new ObjectId().toString(), new ObjectId().toString()];
  const pipeline = buildVectorSearchPipeline({ indexName: 'my_index', queryVector: [0, 1, 0.5, -0.25], userId, documentIds: docs, limit: 5, numCandidates: 3 });
  const stage = pipeline[0].$vectorSearch;

  it('targets the configured index and the embedding path, with numCandidates never below limit', () => {
    expect(stage).toMatchObject({ index: 'my_index', path: 'embedding', limit: 5 });
    expect(stage.numCandidates).toBeGreaterThanOrEqual(5);
  });

  it('pre-filters INSIDE the search by the caller (ObjectId) and the caller\'s authorised documents (ObjectIds)', () => {
    expect(stage.filter.$and[0].userId.$eq).toBeInstanceOf(ObjectId);
    expect(String(stage.filter.$and[0].userId.$eq)).toBe(userId);
    expect(stage.filter.$and[1].documentId.$in.map(String)).toEqual(docs);
    expect(stage.filter.$and[1].documentId.$in.every((x) => x instanceof ObjectId)).toBe(true);
  });

  it('serialises every query-vector component as a BSON double, even integers like 0 and 1 (Atlas rejects Int32)', () => {
    const typeByte = (v) => BSON.serialize({ v })[4]; // 1 = double, 16 = int32
    expect([0, 1].map(typeByte)).toEqual([16, 16]); // the trap: plain JS numbers
    expect(stage.queryVector.map(typeByte)).toEqual([1, 1, 1, 1]); // our fix
  });

  it('projects the similarity score from vectorSearchScore and only the fields we need (never the vector)', () => {
    const project = pipeline[1].$project;
    expect(project.score).toEqual({ $meta: 'vectorSearchScore' });
    expect(project.embedding).toBeUndefined();
  });

  it('index definition declares the vector field and both filter fields, with the requested dimensions', () => {
    expect(vectorIndexDefinition({ numDimensions: 768 }).fields).toEqual([
      { type: 'vector', path: 'embedding', numDimensions: 768, similarity: 'cosine' },
      { type: 'filter', path: 'userId' },
      { type: 'filter', path: 'documentId' },
    ]);
  });
});

describe('LocalRetriever (dev/test fallback)', () => {
  const mk = (userId, documentId, i, text) => ({
    userId, documentId, chunkIndex: i, text, textHash: `${documentId}${i}`, pageStart: 1, pageEnd: 1,
    embedding: hashEmbed(text), embeddingModel: 'fake-embed', embeddingDimensions: 512,
  });
  const alice = new ObjectId(), bob = new ObjectId(), docA = new ObjectId(), docA2 = new ObjectId(), docB = new ObjectId();

  beforeEach(async () => {
    await DocumentChunk.insertMany([
      mk(alice, docA, 0, 'An INNER JOIN returns rows with matching values in both tables'),
      mk(alice, docA, 1, 'Paging divides memory into fixed size frames'),
      mk(alice, docA2, 0, 'A LEFT JOIN keeps all rows from the left table'),
      mk(bob, docB, 0, 'Bob private notes about JOIN secrets and matching values'),
    ]);
  });

  const search = (over) => new LocalRetriever().search({ userId: alice, documentIds: [docA, docA2], queryVector: hashEmbed('what does a join return'), limit: 5, ...over });

  it('ranks the most similar passage first and reports scores on the 0..1 scale', async () => {
    const hits = await search({});
    expect(hits[0].text).toMatch(/JOIN/);
    expect(hits.map((h) => h.score)).toEqual([...hits.map((h) => h.score)].sort((a, b) => b - a));
    expect(hits.every((h) => h.score >= 0 && h.score <= 1)).toBe(true);
    expect(hits[0].score).toBeGreaterThan(hits.at(-1).score);
  });

  it("never returns another user's passages, even when they are the best match and their document id is passed", async () => {
    const hits = await search({ documentIds: [docA, docA2, docB] });
    expect(hits.map((h) => h.documentId)).not.toContain(docB.toString());
    expect(hits.some((h) => /Bob private/.test(h.text))).toBe(false);
  });

  it('restricts to the authorised document ids and honours the limit', async () => {
    expect((await search({ documentIds: [docA2] })).map((h) => h.documentId)).toEqual([docA2.toString()]);
    expect(await search({ limit: 1 })).toHaveLength(1);
    expect(await search({ documentIds: [] })).toEqual([]);
  });

  it('returns source metadata with each hit', async () => {
    const [hit] = await search({});
    expect(hit).toMatchObject({ pageStart: 1, pageEnd: 1 });
    expect(hit.chunkId).toBeTruthy();
    expect(hit.embedding).toBeUndefined();
  });
});

describe('AtlasRetriever failure handling', () => {
  it('turns "vector search unavailable" into a clear 503 without leaking database internals', async () => {
    // This test database (FerretDB) has no $vectorSearch, which is exactly what a missing/unready Atlas index looks like.
    const err = await new AtlasRetriever({ indexName: 'nope' })
      .search({ userId: new ObjectId(), documentIds: [new ObjectId()], queryVector: hashEmbed('x'), limit: 3, numCandidates: 10 })
      .catch((e) => e);
    expect(err.status).toBe(503);
    expect(err.code).toBe('VECTOR_SEARCH_UNAVAILABLE');
    expect(err.message).toMatch(/npm run vector:index/);
    expect(JSON.stringify(err.details ?? '')).not.toMatch(/vectorSearch|FerretDB|\$/);
  });
});

describe('supportScore (lexical support heuristic)', () => {
  it('is high when the answer reuses the cited passage and low when it does not', () => {
    const passage = 'A LEFT JOIN returns all rows from the left table and the matching rows from the right table.';
    expect(supportScore('A left join returns all rows from the left table.', [passage])).toBeGreaterThan(0.8);
    expect(supportScore('Kubernetes schedules containers onto worker nodes using controllers.', [passage])).toBeLessThan(0.2);
  });
  it('treats indexes/indexing/index as the same word and ignores unrelated short text', () => {
    expect(supportScore('Indexing speeds lookups', ['An index speeds up lookups on a column'])).toBeGreaterThan(0.5);
    expect(supportScore('OK', ['anything'])).toBe(1);
  });
});
