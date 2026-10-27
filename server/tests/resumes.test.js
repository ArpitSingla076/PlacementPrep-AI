import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Resume } from '../src/models/Resume.js';
import { JobAnalysis } from '../src/models/JobAnalysis.js';
import { setupDb, teardownDb, clearDb, makeAiApp, registerAgent } from './helpers.js';
import { makePdf, mockLlm, RESUME_LINES, JD, analysisJson } from './fixtures.js';

const app = makeAiApp(mockLlm());
beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(clearDb);

const upload = (u, buffer, { filename = 'resume.pdf', type = 'application/pdf', field = 'file' } = {}) =>
  u.agent.post('/api/resumes').set('X-CSRF-Token', u.csrfToken).attach(field, buffer, { filename, contentType: type });

const goodPdf = (extra = []) => makePdf([[...RESUME_LINES, ...extra]]);

describe('POST /api/resumes', () => {
  it('requires a session and the CSRF header', async () => {
    expect((await request(app).post('/api/resumes').attach('file', goodPdf(), 'r.pdf')).status).toBe(401);
    const u = await registerAgent(app);
    const noCsrf = await u.agent.post('/api/resumes').attach('file', goodPdf(), 'r.pdf');
    expect(noCsrf.status).toBe(403);
  });

  it('parses a PDF, stores the text (not the file) and never returns the text or hash', async () => {
    const u = await registerAgent(app);
    const res = await upload(u, goodPdf());
    expect(res.status).toBe(201);
    expect(res.body.data.duplicate).toBe(false);
    expect(res.body.data.resume).toMatchObject({ originalFilename: 'resume.pdf', pageCount: 1 });
    expect(JSON.stringify(res.body)).not.toMatch(/extractedText|textHash|Spring and MySQL/);

    const stored = await Resume.findOne({}).select('+extractedText');
    expect(stored.extractedText).toContain('Built a library system in Java');
    expect(String(stored.userId)).toBe(u.user.id);
  });

  it('sanitises path tricks in the filename', async () => {
    const u = await registerAgent(app);
    const res = await upload(u, goodPdf(), { filename: '../../etc/passwd<script>.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data.resume.originalFilename).not.toMatch(/[/\\<>]/);
  });

  it('rejects a text file renamed to .pdf (checks the real content, not the name or MIME type)', async () => {
    const u = await registerAgent(app);
    const res = await upload(u, Buffer.from('This is plainly not a PDF. '.repeat(20)), { filename: 'resume.pdf', type: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    expect(await Resume.countDocuments()).toBe(0);
  });

  it('rejects non-PDF types (e.g. an .exe or .docx)', async () => {
    const u = await registerAgent(app);
    const res = await upload(u, Buffer.from('MZ\u0090\u0000'), { filename: 'resume.exe', type: 'application/octet-stream' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  it('rejects oversize files with 413', async () => {
    const u = await registerAgent(app);
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1.5 * 1024 * 1024, 65)]);
    const res = await upload(u, big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects a request with no file, and a file under the wrong field name', async () => {
    const u = await registerAgent(app);
    const none = await u.agent.post('/api/resumes').set('X-CSRF-Token', u.csrfToken);
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('FILE_REQUIRED');
    const wrong = await upload(u, goodPdf(), { field: 'resume' });
    expect(wrong.status).toBe(400);
  });

  it('rejects a corrupted PDF with a clear message', async () => {
    const u = await registerAgent(app);
    const res = await upload(u, Buffer.from('%PDF-1.4\nthis is not a real pdf structure at all, just text that begins like one'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PDF_UNREADABLE');
  });

  it('rejects image-only / empty PDFs (no extractable text)', async () => {
    const u = await registerAgent(app);
    const res = await upload(u, makePdf([[]]));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PDF_NO_TEXT');
    expect(res.body.error.message).toMatch(/scanned/i);
  });

  it('rejects PDFs with too many pages', async () => {
    const u = await registerAgent(app);
    const res = await upload(u, makePdf(Array(7).fill(RESUME_LINES)));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PDF_TOO_MANY_PAGES');
  });

  it('does not create a second record for the same resume text (even with another filename)', async () => {
    const u = await registerAgent(app);
    await upload(u, goodPdf());
    const again = await upload(u, goodPdf(), { filename: 'renamed.pdf' });
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(await Resume.countDocuments()).toBe(1);
  });

  it('enforces the per-user resume limit, but still allows re-uploading an existing one', async () => {
    const u = await registerAgent(app);
    for (let i = 1; i <= 3; i++) expect((await upload(u, goodPdf([`Extra line number ${i} to make this resume unique.`]))).status).toBe(201);
    const over = await upload(u, goodPdf(['A fourth, different resume.']));
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('RESUME_LIMIT_REACHED');
    expect((await upload(u, goodPdf(['Extra line number 1 to make this resume unique.']))).body.data.duplicate).toBe(true);
  });
});

describe('GET/DELETE /api/resumes (ownership + pagination)', () => {
  it('lists only my resumes, paginated', async () => {
    const a = await registerAgent(app, { email: 'a@example.com' });
    const b = await registerAgent(app, { email: 'b@example.com' });
    await upload(a, goodPdf(['A one'])); await upload(a, goodPdf(['A two'])); await upload(b, goodPdf(['B one']));

    const list = await a.agent.get('/api/resumes?limit=1&page=2');
    expect(list.status).toBe(200);
    expect(list.body.data.resumes).toHaveLength(1);
    expect(list.body.data.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect((await b.agent.get('/api/resumes')).body.data.pagination.total).toBe(1);
  });

  it('rejects bad pagination input', async () => {
    const u = await registerAgent(app);
    expect((await u.agent.get('/api/resumes?limit=9999')).status).toBe(400);
    expect((await u.agent.get('/api/resumes?page=0')).status).toBe(400);
  });

  it("returns 404 (not 403) when deleting another user's resume, and leaves it intact", async () => {
    const a = await registerAgent(app, { email: 'a@example.com' });
    const b = await registerAgent(app, { email: 'b@example.com' });
    const id = (await upload(a, goodPdf())).body.data.resume.id;

    const res = await b.agent.delete(`/api/resumes/${id}`).set('X-CSRF-Token', b.csrfToken);
    expect(res.status).toBe(404);
    expect(await Resume.countDocuments()).toBe(1);
    expect((await b.agent.delete('/api/resumes/not-an-id').set('X-CSRF-Token', b.csrfToken)).status).toBe(404);
  });

  it('deleting a resume also deletes the analyses made from it', async () => {
    const u = await registerAgent(app);
    const id = (await upload(u, goodPdf())).body.data.resume.id;
    await JobAnalysis.create({ userId: u.user.id, resumeId: id, jobDescription: JD, inputHash: 'h', requirements: [], score: { overall: 1 } });
    void analysisJson;

    const res = await u.agent.delete(`/api/resumes/${id}`).set('X-CSRF-Token', u.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.data.deletedAnalyses).toBe(1);
    expect(await Resume.countDocuments()).toBe(0);
    expect(await JobAnalysis.countDocuments()).toBe(0);
  });
});
