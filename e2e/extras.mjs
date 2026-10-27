/**
 * Browser test for: application tracker, comparing analyses, quizzes from notes, and account controls
 * (change password, export, delete account). Real backend + client + real SDK against a local Gemini-format fake.
 *   cd e2e && CHROME_PATH=/path/to/chrome node extras.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startFakeGeminiApp } from '../server/tests/fakeGeminiApp.js';
import { makePdf, RESUME_LINES, JD } from '../server/tests/sampleData.js';
import { NOTES } from '../server/eval/corpus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-e2e-x-'));
const OUT = path.join(ROOT, 'e2e', 'out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Set CHROME_PATH to a Chrome or Chromium executable.'); process.exit(2); }
let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = await startFakeGeminiApp({ dims: 512 });
const children = [];
const start = (cmd, args, cwd, env, log) => { const out = fs.openSync(log, 'w'); const c = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', out, out] }); children.push(c); return c; };
const stop = (c) => { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ } };
const waitFor = async (url, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ } await sleep(300); } throw new Error(`timeout ${url}`); };
const env = { NODE_ENV: 'development', PORT: '5000', MONGODB_URI: process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/placementprep_e2e', JWT_SECRET: 'e2e-secret-'.padEnd(48, 'x'), CLIENT_URL: 'http://localhost:5173',
  GEMINI_API_KEY: 'fake-e2e-extras-key-123456', LLM_MODEL: 'fake-flash', EMBEDDING_MODEL: 'fake-embed', EMBEDDING_DIMENSIONS: '512', GEMINI_BASE_URL: fake.url, VECTOR_SEARCH_MODE: 'local', CHUNK_SIZE_CHARS: '400', CHUNK_OVERLAP_CHARS: '80', AI_RETRY_BASE_MS: '10' };
start('node', ['src/server.js'], `${ROOT}/server`, env, path.join(TMP, 'backend.log'));
start('npx', ['vite', '--host', '127.0.0.1'], `${ROOT}/client`, {}, path.join(TMP, 'vite.log'));
await waitFor('http://127.0.0.1:5000/api/health'); await waitFor('http://127.0.0.1:5173/');
fs.writeFileSync(path.join(TMP, 'resume.pdf'), makePdf([RESUME_LINES]));
fs.writeFileSync(path.join(TMP, 'dbms-notes.pdf'), makePdf(NOTES['dbms-notes.pdf']));

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
const clickText = async (text, scope = 'body') => { const h = await page.evaluateHandle((t, s) => [...document.querySelectorAll(`${s} button, ${s} a`)].find((e) => e.innerText.replace(/\s+/g, ' ').trim().includes(t)), text, scope); if (!h.asElement()) throw new Error(`no button "${text}" in ${scope}`); await h.asElement().click(); };
const typeInto = async (sel, text) => { await page.click(sel); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.type(sel, text, { delay: 0 }); };
const control = async (label, scope) => { const h = await page.evaluateHandle((l, s) => { const el = [...document.querySelectorAll(`${s} label`)].find((x) => x.innerText.trim().startsWith(l)); return el && (el.control ?? el.querySelector('input,textarea,select')); }, label, scope); if (!h.asElement()) throw new Error(`no field "${label}" in ${scope}`); return h.asElement(); };
const fill = async (label, text, scope = 'dialog[open]') => { const c = await control(label, scope); await c.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await c.type(text); };
const enabled = (sel) => page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, { timeout: 8000 }, sel);
const settle = () => page.waitForFunction(() => !document.querySelector('[aria-live="polite"] [role]'), { timeout: 10000 }).catch(() => {});
const dlgBtn = 'dialog[open] button.border-bad\\/30';

try {
  // ---- register + consent
  await goto('/register');
  const EMAIL = `x.${Date.now()}@example.com`;
  await page.type('input[autocomplete=name]', 'Asha Rao'); await page.type('input[type=email]', EMAIL); await page.type('input[type=password]', 'correct-horse-1');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Asha'));
  await goto('/documents'); await clickText('Allow AI processing'); await page.waitForFunction(() => !document.querySelector('#consent-title'));
  check(true, 'registered and gave AI consent');

  // ---- two analyses, to compare later
  await goto('/resume-analyzer');
  await (await page.$('#resume-file')).uploadFile(path.join(TMP, 'resume.pdf'));
  await page.waitForSelector('input[type=radio]');
  for (const suffix of ['', ' Second variant of the same job.']) {
    await goto('/resume-analyzer');
    await typeInto('#jd', JD + suffix);
    await enabled('form button[type=submit]'); await page.click('form button[type=submit]');
    await page.waitForFunction(() => /\/resume-analyzer\/[0-9a-f]{24}$/.test(location.pathname), { timeout: 30000 });
    await waitText(/Estimated match/);
  }
  check(true, 'two resume analyses created');

  // ---- compare
  const sel = await page.$('select');
  const opts = await sel.$$eval('option', (o) => o.map((x) => x.value).filter(Boolean));
  check(opts.length === 1, 'report: "Compare with…" lists the other analysis');
  await sel.select(opts[0]);
  await page.waitForFunction(() => location.pathname === '/resume-analyzer/compare', { timeout: 10000 });
  check(await waitText(/Compare analyses/) && await waitText(/No change in match score/), 'compare: shows the score change between the two reports');
  const cmp = await body();
  check(/Skill-by-skill|Baseline/.test(cmp) && /Java/.test(cmp) && /No change/.test(cmp), 'compare: skill-by-skill table is shown');
  await page.screenshot({ path: path.join(OUT, 'compare.png'), fullPage: true });

  // ---- applications
  await goto('/applications');
  check(/No applications yet/.test(await body()), 'applications: empty state for a new user');
  await clickText('Add application'); await page.waitForSelector('dialog[open]');
  await fill('Company', 'Acme Corp'); await fill('Role', 'Backend Intern'); await fill('Job link', 'javascript:alert(1)');
  await clickText('Add application', 'dialog[open]');
  check(await waitText(/Enter a full http\(s\) link/), 'applications: a javascript: link is rejected with a clear message');
  await fill('Job link', 'https://acme.example.com/jobs/1');
  await fill('Location', 'Pune');
  await clickText('Add application', 'dialog[open]');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 10000 });
  check(await waitText(/Acme Corp/) && /Backend Intern/.test(await body()), 'applications: added and shown in the Saved column');
  const link = await page.$eval('a[aria-label^="Open job link"]', (a) => ({ rel: a.rel, target: a.target, href: a.href }));
  check(link.rel.includes('noopener') && link.target === '_blank' && link.href.startsWith('https://acme.example.com'), 'applications: job link opens safely in a new tab');
  await (await page.$('select[id^="mv-"]')).select('applied');
  check(await page.waitForFunction(() => document.querySelector('#col-applied')?.parentElement.innerText.includes('Acme Corp'), { timeout: 10000 }).then(() => true).catch(() => false), 'applications: changing status moves the card to the Applied column');
  await page.click('button[aria-label="Edit Acme Corp"]'); await page.waitForSelector('dialog[open]');
  const analysisSel = await control('Resume analysis for this job', 'dialog[open]');
  const aOpts = await analysisSel.$$eval('option', (o) => o.map((x) => x.value).filter(Boolean));
  await analysisSel.select(aOpts[0]); await fill('Notes', 'Referral from a senior.');
  await clickText('Save changes', 'dialog[open]');
  check(await waitText(/Resume match/) && /Referral from a senior/.test(await body()), 'applications: linking an analysis shows its match score on the card');
  await page.screenshot({ path: path.join(OUT, 'applications.png'), fullPage: true });

  // ---- quiz from notes
  await goto('/documents');
  await (await page.$('#doc-file')).uploadFile(path.join(TMP, 'dbms-notes.pdf'));
  check(await waitText(/Ready/, 25000), 'quiz setup: notes uploaded and ready');
  await goto('/quizzes');
  await (await page.$('select')).select('3');
  await enabled('form button[type=submit]'); await page.click('form button[type=submit]');
  await page.waitForFunction(() => /\/quizzes\/[0-9a-f]{24}$/.test(location.pathname), { timeout: 30000 });
  check(await waitText(/Question 1/i), 'quiz: questions are generated from the notes');
  check(!/correct answer|Why:/.test(await body()), 'quiz: answers and explanations are hidden before submitting');
  const sets = await page.$$('fieldset');
  for (const fs of sets) await (await fs.$('input[type=radio]')).click();
  await clickText('Submit quiz');
  check(await waitText(/Score: \d+ of \d+/), 'quiz: submitting shows the score');
  const review = await body();
  check(/correct answer/.test(review) && /Why:/.test(review) && /Source: dbms-notes\.pdf/.test(review), 'quiz: review shows the right answer, explanation and source file');
  await page.click('details summary');
  check(/join|normaliz|normal form|relational|dependenc|key/i.test(await page.$eval('details[open] blockquote', (b) => b.innerText)), 'quiz: the source passage from the notes can be opened (quizzes use random passages, so any text from the notes qualifies)');
  await page.screenshot({ path: path.join(OUT, 'quiz.png'), fullPage: true });
  await goto('/quizzes');
  check(await waitText(/\d+%/), 'quiz: completed quiz appears in history with its score');

  // ---- progress
  await goto('/progress');
  await waitText(/Quizzes taken/);
  check(/Quizzes taken 1/.test(await body()) && /Applications/.test(await body()) && /applied 1/i.test(await body()), 'progress: shows quiz and application data');

  // ---- account: change password, export, delete
  await goto('/settings');
  await fill('Current password', 'correct-horse-1', 'main'); await fill('New password', 'brand-new-pass-2', 'main');
  await clickText('Change password');
  check(await waitText(/Password changed/), 'account: password change succeeds');
  await settle();
  await clickText('Save changes');
  check(await waitText(/Settings saved/), 'account: the session keeps working after a password change (new CSRF token picked up)');
  const exported = await page.evaluate(() => fetch('/api/users/me/export').then((r) => r.json()));
  check(exported.success && exported.data.applications.length === 1 && exported.data.jobAnalyses.length === 2 && exported.data.documents.length === 1 && !JSON.stringify(exported).includes('passwordHash'), 'account: export contains my data and no password hash');
  await settle();
  await clickText('Download my data');
  check(await waitText(/Your data was downloaded/), 'account: "Download my data" works');
  await settle();
  await clickText('Delete my account'); await page.waitForSelector('dialog[open]');
  await fill('Password', 'wrong-password-1');
  await page.click(dlgBtn);
  check(await waitText(/password is not correct/i), 'account: wrong password does not delete anything');
  await fill('Password', 'brand-new-pass-2');
  await page.click(dlgBtn);
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 });
  check(true, 'account: deleting with the right password signs out to /login');
  await page.waitForSelector('input[type=email]');
  await page.type('input[type=email]', EMAIL); await page.type('input[type=password]', 'brand-new-pass-2');
  await page.click('button[type=submit]');
  check(await waitText(/Invalid email or password/), 'account: the deleted account can no longer sign in');

  // ---- mobile overflow on the new pages (use a fresh account for pages that need a session)
  await goto('/register');
  await page.type('input[autocomplete=name]', 'Mobile User'); await page.type('input[type=email]', `m.${Date.now()}@example.com`); await page.type('input[type=password]', 'correct-horse-1');
  await page.click('button[type=submit]'); await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Mobile'));
  await page.setViewport({ width: 390, height: 844 });
  for (const p of ['/applications', '/quizzes', '/settings', '/progress']) {
    await goto(p); await sleep(400);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 ? [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 3).join('.')}`) : []);
    if (over.length) console.log('  overflow offenders on', p, over);
    check(over.length === 0, `mobile: ${p} has no horizontal overflow`);
  }

  const log = fs.readFileSync(path.join(TMP, 'backend.log'), 'utf8');
  check(!log.includes('fake-e2e-extras-key') && !/brand-new-pass|correct-horse|Referral from a senior|LEFT JOIN returns/.test(log), 'server log contains no secrets, passwords, notes or document text');
  const bad = consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of (400|401|403|404|409|413|422|429|502|503)/.test(e));
  check(bad.length === 0, `no unexpected browser console errors ${bad.length ? JSON.stringify(bad.slice(0, 3)) : ''}`);
} catch (e) {
  fail++; console.log('FAIL  script error:', e.message);
  await page.screenshot({ path: path.join(OUT, 'extras-error.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close(); children.forEach(stop); await fake.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
