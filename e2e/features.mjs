/**
 * Full-stack browser test for documents, the grounded assistant, mock interviews, the preparation plan and progress.
 * Real backend + real Vite client + real @google/genai SDK against a local Gemini-format fake (never contacts Google).
 *   cd e2e && npm install && CHROME_PATH=/path/to/chrome node features.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startFakeGeminiApp } from '../server/tests/fakeGeminiApp.js';
import { makePdf } from '../server/tests/sampleData.js';
import { NOTES } from '../server/eval/corpus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-e2e-f-'));
const OUT = path.join(ROOT, 'e2e', 'out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Set CHROME_PATH to a Chrome or Chromium executable.'); process.exit(2); }
const FAKE_KEY = 'fake-e2e-features-key-123456';
let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = await startFakeGeminiApp({ dims: 512 });
const children = [];
const start = (cmd, args, cwd, env, log) => { const out = fs.openSync(log, 'w'); const c = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', out, out] }); children.push(c); return c; };
const stop = (c) => { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ } };
const waitFor = async (url, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ } await sleep(300); } throw new Error(`timeout ${url}`); };

const env = { NODE_ENV: 'development', PORT: '5000', MONGODB_URI: process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/placementprep_e2e', JWT_SECRET: 'e2e-secret-'.padEnd(48, 'x'), CLIENT_URL: 'http://localhost:5173',
  GEMINI_API_KEY: FAKE_KEY, LLM_MODEL: 'fake-flash', EMBEDDING_MODEL: 'fake-embed', EMBEDDING_DIMENSIONS: '512', GEMINI_BASE_URL: fake.url,
  VECTOR_SEARCH_MODE: 'local', CHUNK_SIZE_CHARS: '400', CHUNK_OVERLAP_CHARS: '80', RAG_MIN_SCORE: '0.6', AI_RETRY_BASE_MS: '10' };
const backend = start('node', ['src/server.js'], `${ROOT}/server`, env, path.join(TMP, 'backend.log'));
start('npx', ['vite', '--host', '127.0.0.1'], `${ROOT}/client`, {}, path.join(TMP, 'vite.log'));
await waitFor('http://127.0.0.1:5000/api/health'); await waitFor('http://127.0.0.1:5173/');

for (const name of ['dbms-notes.pdf', 'os-notes.pdf']) fs.writeFileSync(path.join(TMP, name), makePdf(NOTES[name]));
fs.writeFileSync(path.join(TMP, 'fake.pdf'), 'plain text pretending to be a pdf. '.repeat(20));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--host-resolver-rules=MAP localhost 127.0.0.1'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e}`));
const BASE = 'http://localhost:5173';
const body = () => page.$eval('body', (b) => b.innerText.replace(/\s+/g, ' '));
const goto = (p) => page.goto(`${BASE}${p}`, { waitUntil: 'networkidle0' });
const waitText = async (re, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (re.test(await body())) return true; await sleep(250); } return false; };
const click = (sel) => page.click(sel);
const clickText = async (text) => { const h = await page.evaluateHandle((t) => [...document.querySelectorAll('button,a')].find((e) => e.innerText.replace(/\s+/g, ' ').trim().includes(t)), text); if (!h.asElement()) throw new Error(`no button "${text}"`); await h.asElement().click(); };
const enabled = (sel) => page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, { timeout: 8000 }, sel);
const typeInto = async (sel, text) => { await page.click(sel); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.type(sel, text, { delay: 0 }); };

try {
  // ---- register + consent
  await goto('/register');
  await page.type('input[autocomplete=name]', 'Asha Rao'); await page.type('input[type=email]', `feat.${Date.now()}@example.com`); await page.type('input[type=password]', 'correct-horse-1');
  await click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Asha'));
  check(true, 'registered');

  // ---- documents
  await goto('/documents');
  check(!!(await page.$('#consent-title')), 'documents: consent card shown before upload');
  check(await page.$eval('#doc-file', (i) => i.disabled), 'documents: upload is disabled without consent');
  await clickText('Allow AI processing');
  await page.waitForFunction(() => !document.querySelector('#consent-title'));
  const input = await page.$('#doc-file');
  await input.uploadFile(path.join(TMP, 'fake.pdf'));
  check(await waitText(/not a valid PDF/i), 'documents: a fake .pdf is rejected with a clear message');
  await input.uploadFile(path.join(TMP, 'dbms-notes.pdf'));
  check(await waitText(/dbms-notes\.pdf/), 'documents: upload accepted and listed');
  check(await waitText(/Ready/), 'documents: status moves from Processing to Ready (polling)');
  check(/\d+ searchable passages/.test(await body()), 'documents: shows the number of searchable passages');
  await input.uploadFile(path.join(TMP, 'os-notes.pdf'));
  await waitText(/os-notes\.pdf/); await waitText(/Ready.*Ready|Ready[\s\S]*os-notes|os-notes[\s\S]*Ready/);
  await sleep(2500);
  await input.uploadFile(path.join(TMP, 'os-notes.pdf'));
  check(await waitText(/already uploaded/i), 'documents: re-uploading the same file is detected as a duplicate');
  await page.screenshot({ path: path.join(OUT, 'documents.png'), fullPage: true });

  // ---- assistant: grounded answer with citations
  await goto('/assistant');
  check((await body()).includes('grounded in the notes you uploaded'), 'assistant: states that answers are grounded in uploaded notes');
  await clickText('What is the difference between an INNER JOIN and a LEFT JOIN?');
  await page.waitForSelector('button[aria-label="Open source 1"]', { timeout: 20000 });
  check(/LEFT JOIN/i.test(await body()), 'assistant: answer text comes from the notes');
  await page.screenshot({ path: path.join(OUT, 'assistant.png'), fullPage: true });
  await click('button[aria-label="Open source 1"]');
  await page.waitForSelector('dialog[open]');
  const dlg = await page.$eval('dialog[open]', (d) => d.innerText.replace(/\s+/g, ' '));
  check(dlg.includes('dbms-notes.pdf') && /page 1/.test(dlg) && /LEFT JOIN returns all rows from the left table/.test(dlg), 'assistant: clicking a citation shows the document, page and exact passage');
  await page.keyboard.press('Escape'); await sleep(200);
  check(/sources/i.test(await body()) && /dbms-notes\.pdf, page/.test(await body()), 'assistant: sources list shows file and page');

  // ---- assistant: question the notes cannot answer
  await typeInto('#q', 'How do Kubernetes pods get scheduled onto nodes?');
  await enabled('button[aria-label="Send question"]');
  await click('button[aria-label="Send question"]');
  check(await waitText(/Not found in your notes/), 'assistant: a question outside the notes gets "Not found in your notes", not a guess');

  // ---- conversations
  await clickText('New conversation');
  check((await page.$$eval('[aria-label="Conversation"] .rounded-card.bg-navy-900', (x) => x.length)) === 0, 'assistant: new conversation clears the thread');
  const convButtons = await page.$$('aside[aria-label="Conversations"] ul li > button:first-child');
  check(convButtons.length >= 1, 'assistant: conversation history is listed');
  await convButtons[0].click();
  check(await waitText(/INNER JOIN and a LEFT JOIN|Kubernetes/), 'assistant: opening a past conversation restores its messages');

  // ---- assistant: provider failure
  fake.state.mode = 'rate_limit';
  await clickText('New conversation');
  await typeInto('#q', 'What is a deadlock?'); await enabled('button[aria-label="Send question"]'); await click('button[aria-label="Send question"]');
  check(await waitText(/rate limiting/i), 'assistant: provider rate limit shows a clear message');
  check((await page.$eval('#q', (t) => t.value)) === 'What is a deadlock?', 'assistant: the question text is kept so nothing is lost');
  fake.state.mode = 'ok';

  // ---- documents: delete
  await goto('/documents');
  await click('button[aria-label="Delete os-notes.pdf"]'); await page.waitForSelector('dialog[open]');
  await click('dialog[open] button.border-bad\\/30');
  await page.waitForFunction(() => !document.body.innerText.includes('os-notes.pdf'), { timeout: 10000 });
  check(true, 'documents: deleting a document removes it');

  // ---- mock interview (4 questions: SQL joins x2, Normalization x2)
  await goto('/interviews');
  await typeInto('input[placeholder="e.g. Backend Developer"]', 'Backend Developer');
  await page.select('select:nth-of-type(1)', 'fresher').catch(() => {});
  const nq = await page.$$('select');
  for (const s of nq) { const opts = await s.$$eval('option', (o) => o.map((x) => x.value)); if (opts.includes('7')) await s.select('5'); }
  await enabled('form button[type=submit]'); await click('form button[type=submit]');
  await page.waitForFunction(() => /\/interviews\/[0-9a-f]{24}$/.test(location.pathname), { timeout: 30000 });
  check(await waitText(/question 1 of \d+/i, 15000), 'interview: questions are generated and shown one at a time');
  check(!/key ideas|atomic values per column/i.test(await body()), 'interview: the rubric is hidden before answering');
  const GOOD = 'Each column holds atomic values, the primary key identifies rows, and partial dependencies are removed in second normal form.';
  const POOR = 'I think databases are interesting and widely used in industry today.';
  const total = Number(/question 1 of (\d+)/i.exec(await body())[1]);
  for (let i = 0; i < total; i++) {
    await page.waitForSelector('#ans');
    await typeInto('#ans', i === 0 ? GOOD : POOR);
    await enabled('form button[type=submit]'); await click('form button[type=submit]');
    check(await waitText(/What you got right/), `interview: answer ${i + 1} is evaluated with feedback`);
    if (i === 0) { const t = await body(); check(t.includes('91 / 100') && /Covered/i.test(t) && /A stronger answer/i.test(t) && /Follow-up/i.test(t), 'interview: good answer scores 91/100 with covered points, stronger answer and follow-up'); await page.screenshot({ path: path.join(OUT, 'interview.png'), fullPage: true }); }
    if (i === 1) check(/Correctness was capped/.test(await body()), 'interview: an answer covering nothing has correctness capped');
    if (i < total - 1) await clickText('Next question');
  }
  check(await waitText(/Results: \d+ \/ 100/), 'interview: completing all questions shows results');
  check(/By dimension/.test(await body()) && /By topic/.test(await body()), 'interview: results break down by dimension and topic');
  await clickText('All interviews');
  check(await waitText(/\d+\/100/), 'interview: completed session appears in history with its average');

  // ---- preparation plan
  await goto('/preparation-plan');
  await clickText('Generate my plan');
  check(await waitText(/AI suggestion/i, 25000), 'plan: generated from saved interview results');
  const planText = await body();
  check(/Observed in your interviews/i.test(planText) && /AI suggestion/i.test(planText), 'plan: separates observed evidence from AI suggestions');
  check(/priority/i.test(planText) && /0 of \d+ done/.test(planText), 'plan: shows priorities and completion progress');
  await page.screenshot({ path: path.join(OUT, 'plan.png'), fullPage: true });
  await click('input[type=checkbox]');
  check(await waitText(/1 of \d+ done/), 'plan: ticking an item updates progress');

  // ---- progress
  await goto('/progress');
  await page.waitForSelector('.recharts-wrapper', { timeout: 15000 });
  const prog = await body();
  check(/Interviews completed 1/.test(prog) && /Questions answered \d+/.test(prog), 'progress: counts are derived from saved results');
  check((await page.$$('.recharts-wrapper')).length >= 2, 'progress: charts render');
  check(/Topics needing revision/.test(prog), 'progress: shows topics needing revision');
  await page.select('select', '30');
  await sleep(800);
  check(!(await alertsText()).length, 'progress: changing the time filter works without errors');
  await page.screenshot({ path: path.join(OUT, 'progress.png'), fullPage: true });

  // ---- dashboard
  await goto('/');
  check(await waitText(/Preparation priorities/) && /Progress summary/.test(await body()) && !/No scores recorded/.test(await body()), 'dashboard: shows real progress data');

  // ---- mobile
  await page.setViewport({ width: 390, height: 844 });
  for (const p of ['/assistant', '/progress', '/preparation-plan', '/interviews']) {
    await goto(p); await sleep(400);
    const over = await page.evaluate(() => {
      if (document.documentElement.scrollWidth <= window.innerWidth + 1) return [];
      return [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 6)
        .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 4).join('.')} right=${Math.round(e.getBoundingClientRect().right)}`);
    });
    if (over.length) console.log('  overflow offenders on', p, over);
    check(over.length === 0, `mobile: ${p} has no horizontal overflow`);
  }

  // ---- logs
  const log = fs.readFileSync(path.join(TMP, 'backend.log'), 'utf8');
  check(!log.includes(FAKE_KEY), 'server log does not contain the API key');
  check(!/LEFT JOIN returns|mutual exclusion|atomic values/.test(log), 'server log does not contain document or answer text');
  const bad = consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of (400|401|403|404|409|413|422|429|502|503)/.test(e));
  check(bad.length === 0, `no unexpected browser console errors ${bad.length ? JSON.stringify(bad.slice(0, 3)) : ''}`);
} catch (e) {
  fail++; console.log('FAIL  script error:', e.message);
  await page.screenshot({ path: path.join(OUT, 'features-error.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close(); children.forEach(stop); await fake.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
async function alertsText() { return page.$$eval('[role=alert]', (els) => els.map((e) => e.textContent.trim())).catch(() => []); }
