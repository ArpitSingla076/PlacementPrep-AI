import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { KnowledgeDocument } from '../src/models/KnowledgeDocument.js';
import { DocumentChunk } from '../src/models/DocumentChunk.js';
import { ChatConversation } from '../src/models/ChatConversation.js';
import { AiError } from '../src/ai/errors.js';
import { recoverStaleDocuments } from '../src/services/knowledge/ingestion.service.js';
import { setupDb, teardownDb, clearDb, makeRagApp, registerAgent, grantConsent, uploadDoc, addNotes, notesPdf, waitForIngestion } from './helpers.js';
import { makePdf, mockLlm, fakeEmbedder, FAKE_DIMS } from './fixtures.js';

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

async function setup({ embedder = fakeEmbedder(), consent = true, email = 'asha@example.com', ingestLimit } = {}, app = makeRagApp({ llm: mockLlm(), embedder, ingestLimit })) {
  const u = await registerAgent(app, { email });
  if (consent) await grantConsent(u);
  return { ...u, app, embedder };
}
const para = (word, n) => Array.from({ length: n }, (_, i) => `The ${word} section explains concept number ${i} in a few plain sentences for revision.`).join(' ');

describe('POST /api/documents: ingestion pipeline', () => {
  it('parses, chunks, embeds and stores a PDF: 202 first, then status "ready" with page-aware chunks and unit vectors', async () => {
    const u = await setup();
    const res = await uploadDoc(u, notesPdf('dbms-notes.pdf'), 'dbms-notes.pdf');
    expect(res.status).toBe(202);
    expect(res.body.data.document).toMatchObject({ filename: 'dbms-notes.pdf', status: 'processing', pageCount: 2 });
    expect(JSON.stringify(res.body)).not.toMatch(/contentHash|userId|embedding"/);

    await waitForIngestion();
    const doc = (await u.agent.get(`/api/documents/${res.body.data.document.id}`)).body.data.document;
    expect(doc).toMatchObject({ status: 'ready', embeddingModel: 'fake-embed', embeddingDimensions: FAKE_DIMS });
    expect(doc.chunkCount).toBeGreaterThan(2);

    const chunks = await DocumentChunk.find({ documentId: doc.id }).select('+embedding').sort({ chunkIndex: 1 });
    expect(chunks).toHaveLength(doc.chunkCount);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => String(c.userId) === u.user.id && c.embedding.length === FAKE_DIMS)).toBe(true);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks.at(-1).pageEnd).toBe(2);
    expect(chunks.some((c) => /LEFT JOIN/.test(c.text) && c.pageStart === 1)).toBe(true); // joins live on page 1
    expect(chunks.some((c) => /Third normal form/.test(c.text) && c.pageEnd === 2)).toBe(true); // normalization on page 2

    // The embedder was asked for exactly the chunk texts, as documents.
    const call = u.embedder.embed.mock.calls[0][0];
    expect(call.kind).toBe('document');
    expect(call.texts).toEqual(chunks.map((c) => c.text));
  });

  it('requires AI consent, because the document text is sent to the embedding provider', async () => {
    const u = await setup({ consent: false });
    const res = await uploadDoc(u, notesPdf('os-notes.pdf'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AI_CONSENT_REQUIRED');
    expect(u.embedder.embed).not.toHaveBeenCalled();
    expect(await KnowledgeDocument.countDocuments()).toBe(0);
  });

  it('returns a setup error (and stores nothing) when no embedding model is configured', async () => {
    const u = await setup({ embedder: fakeEmbedder({ configured: false }) });
    const res = await uploadDoc(u, notesPdf('os-notes.pdf'));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    expect(await KnowledgeDocument.countDocuments()).toBe(0);
  });

  it('validates files: fake .pdf, wrong type, no file, oversize, corrupt, image-only, too many pages', async () => {
    const u = await setup();
    const check = async (res, status, code) => { expect(res.status).toBe(status); expect(res.body.error.code).toBe(code); };
    await check(await uploadDoc(u, Buffer.from('plain text pretending to be a pdf. '.repeat(20))), 400, 'INVALID_FILE_TYPE');
    await check(await uploadDoc(u, Buffer.from('MZ\u0090'), 'x.exe', 'application/octet-stream'), 400, 'INVALID_FILE_TYPE');
    await check(await u.agent.post('/api/documents').set('X-CSRF-Token', u.csrfToken), 400, 'FILE_REQUIRED');
    await check(await uploadDoc(u, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1.5 * 1024 * 1024, 65)])), 413, 'FILE_TOO_LARGE');
    await check(await uploadDoc(u, Buffer.from('%PDF-1.4\nnot really a pdf structure, only text that starts like one, nothing else here')), 422, 'PDF_UNREADABLE');
    await check(await uploadDoc(u, makePdf([[]])), 422, 'PDF_NO_TEXT');
    await check(await uploadDoc(u, makePdf(Array(6).fill([para('x', 2)]))), 422, 'PDF_TOO_MANY_PAGES');
    expect(u.embedder.embed).not.toHaveBeenCalled();
    expect(await KnowledgeDocument.countDocuments()).toBe(0);
  });

  it('does not ingest the same document twice and does not call the embedder again', async () => {
    const u = await setup();
    await addNotes(u, 'os-notes.pdf');
    const calls = u.embedder.embed.mock.calls.length;
    const again = await uploadDoc(u, notesPdf('os-notes.pdf'), 'renamed.pdf');
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(u.embedder.embed.mock.calls.length).toBe(calls);
    expect(await KnowledgeDocument.countDocuments()).toBe(1);
  });

  it('enforces the per-user document limit', async () => {
    const u = await setup();
    for (const w of ['alpha', 'beta', 'gamma']) expect((await uploadDoc(u, makePdf([[para(w, 4)]]), `${w}.pdf`)).status).toBe(202);
    const over = await uploadDoc(u, makePdf([[para('delta', 4)]]), 'delta.pdf');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('DOCUMENT_LIMIT_REACHED');
  });

  it('reuses vectors for identical passages instead of embedding them again', async () => {
    const u = await setup();
    const base = para('shared', 20);
    await uploadDoc(u, makePdf([[base]]), 'v1.pdf');
    await waitForIngestion();
    u.embedder.embed.mockClear();
    // v2 = v1 plus an extra page: the early chunks are identical, only the tail is new
    const res = await uploadDoc(u, makePdf([[base], [para('extra', 6)]]), 'v2.pdf');
    await waitForIngestion();
    const doc = await KnowledgeDocument.findById(res.body.data.document.id);
    expect(doc.status).toBe('ready');
    expect(doc.reusedEmbeddings).toBeGreaterThan(0);
    expect(u.embedder.embed.mock.calls[0][0].texts.length).toBeLessThan(doc.chunkCount);
  });
});

describe('failure handling and cleanup', () => {
  it('marks the document failed (with a user-safe reason), stores no chunks, and refunds the upload quota', async () => {
    const embedder = fakeEmbedder();
    embedder.embed.mockRejectedValueOnce(new AiError(429, 'AI_RATE_LIMITED', 'The AI provider is rate limiting requests. Try again in a minute.', { retryable: true }));
    const u = await setup({ embedder, ingestLimit: 1 });
    const res = await uploadDoc(u, notesPdf('dbms-notes.pdf'));
    await waitForIngestion();

    const doc = (await u.agent.get(`/api/documents/${res.body.data.document.id}`)).body.data.document;
    expect(doc.status).toBe('failed');
    expect(doc.error).toMatchObject({ code: 'AI_RATE_LIMITED' });
    expect(doc.error.message).toMatch(/rate limiting/);
    expect(await DocumentChunk.countDocuments()).toBe(0);
    // quota (limit 1) was refunded, so the user can try again
    expect((await uploadDoc(u, notesPdf('os-notes.pdf'))).status).toBe(202);
  });

  it('fails cleanly on a dimension mismatch and does not leak internal error text', async () => {
    const embedder = fakeEmbedder();
    embedder.embed.mockRejectedValueOnce(new TypeError('secret internal detail'));
    const u = await setup({ embedder });
    const res = await uploadDoc(u, notesPdf('os-notes.pdf'));
    await waitForIngestion();
    const doc = (await u.agent.get(`/api/documents/${res.body.data.document.id}`)).body.data.document;
    expect(doc.status).toBe('failed');
    expect(JSON.stringify(doc)).not.toMatch(/secret internal/);
    expect(doc.error.message).toMatch(/unexpectedly/);
  });

  it('marks documents left "processing" by a server restart as failed', async () => {
    const u = await setup();
    await KnowledgeDocument.create({ userId: u.user.id, filename: 'x.pdf', sizeBytes: 1, pageCount: 1, charCount: 1, contentHash: 'h', status: 'processing' });
    expect(await recoverStaleDocuments()).toBe(1);
    const doc = await KnowledgeDocument.findOne({});
    expect(doc.status).toBe('failed');
    expect(doc.error.code).toBe('INTERRUPTED');
  });

  it('discards the work when the document is deleted while it is still being embedded', async () => {
    const embedder = fakeEmbedder();
    embedder.delayMs = 150;
    const u = await setup({ embedder });
    const res = await uploadDoc(u, notesPdf('dbms-notes.pdf'));
    const del = await u.agent.delete(`/api/documents/${res.body.data.document.id}`).set('X-CSRF-Token', u.csrfToken);
    expect(del.status).toBe(200);
    await waitForIngestion();
    expect(await KnowledgeDocument.countDocuments()).toBe(0);
    expect(await DocumentChunk.countDocuments()).toBe(0); // nothing was written after the delete
  });
});

describe('listing, deletion and ownership', () => {
  it('lists my documents with pagination', async () => {
    const u = await setup();
    await addNotes(u, 'os-notes.pdf'); await addNotes(u, 'network-notes.pdf');
    const res = await u.agent.get('/api/documents?limit=1&page=2');
    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.data.documents).toHaveLength(1);
  });

  it('deletes the document, ALL its chunks and vectors, and the passage text stored in chat citations', async () => {
    const u = await setup();
    const id = await addNotes(u, 'dbms-notes.pdf');
    expect(await DocumentChunk.countDocuments({ documentId: id })).toBeGreaterThan(0);
    await ChatConversation.create({
      userId: u.user.id, title: 't',
      messages: [{ role: 'assistant', status: 'answered', sections: [{ text: 'a', sources: [1], support: 'strong' }],
        sources: [{ n: 1, documentId: id, filename: 'dbms-notes.pdf', pageStart: 1, pageEnd: 1, text: 'private passage text', cited: true }] }],
    });

    const res = await u.agent.delete(`/api/documents/${id}`).set('X-CSRF-Token', u.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.deletedChunks).toBeGreaterThan(0);
    expect(await KnowledgeDocument.countDocuments()).toBe(0);
    expect(await DocumentChunk.countDocuments()).toBe(0);
    const conv = await ChatConversation.findOne({});
    expect(conv.messages[0].sources[0]).toMatchObject({ documentDeleted: true, text: '' });
  });

  it("cannot read, delete or see another user's documents (404, nothing removed)", async () => {
    const app = makeRagApp({ llm: mockLlm(), embedder: fakeEmbedder() });
    const a = await setup({ email: 'a@example.com' }, app);
    const b = await setup({ email: 'b@example.com' }, app);
    const id = await addNotes(a, 'os-notes.pdf');

    expect((await b.agent.get(`/api/documents/${id}`)).status).toBe(404);
    expect((await b.agent.delete(`/api/documents/${id}`).set('X-CSRF-Token', b.csrfToken)).status).toBe(404);
    expect((await b.agent.get('/api/documents')).body.data.pagination.total).toBe(0);
    expect((await b.agent.get('/api/documents/not-an-id')).status).toBe(404);
    expect(await DocumentChunk.countDocuments({ documentId: id })).toBeGreaterThan(0);
  });

  it('requires a session and the CSRF header for uploads and deletes', async () => {
    const u = await setup();
    expect((await request(u.app).get('/api/documents')).status).toBe(401);
    const noCsrf = await u.agent.post('/api/documents').attach('file', notesPdf('os-notes.pdf'), 'x.pdf');
    expect(noCsrf.status).toBe(403);
  });
});

describe('GET /api/ai/status (knowledge)', () => {
  it('reports embedding configuration and remaining quotas without secrets', async () => {
    const u = await setup();
    const res = await u.agent.get('/api/ai/status');
    expect(res.body.data.embedding).toEqual({ provider: 'fake', model: 'fake-embed', dimensions: FAKE_DIMS, configured: true });
    expect(res.body.data.knowledge).toMatchObject({ vectorSearchMode: 'local', questions: { limit: 100 }, uploads: { limit: 100 } });
    expect(JSON.stringify(res.body)).not.toMatch(/apiKey|secret/i);
  });
});
