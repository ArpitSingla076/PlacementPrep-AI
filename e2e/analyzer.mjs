import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { makePdf, RESUME_LINES, JD, analysisJson } from '../server/tests/sampleData.js';

/**
 * Full-stack browser test (NOT part of npm test). Starts the real backend and the Vite client, points the backend's real
 * Gemini SDK at a local fake that speaks Gemini's wire format, then drives Chrome through every user flow.
 * It never contacts Google. Needs a MongoDB (E2E_MONGODB_URI, default local), puppeteer-core and Chrome (CHROME_PATH).
 *   cd e2e && npm install && CHROME_PATH=/path/to/chrome npm start
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-e2e-'));
const OUT = path.join(ROOT, 'e2e', 'out');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Set CHROME_PATH to a Chrome or Chromium executable.'); process.exit(2); }
const FAKE_KEY = 'fake-e2e-key-do-not-leak-123456';
let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- scriptable fake Gemini (wire format only) ----
const fake = { mode: 'ok', requests: [] };
const gem = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 800, totalTokenCount: 2000 } });
const gserver = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c));
  req.on('end', () => {
    fake.requests.push({ url: req.url, body: raw });
    const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (fake.mode === 'rate_limit') return send(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } });
    if (fake.mode === 'down') return send(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'overloaded' } });
    if (fake.mode === 'invalid') return send(200, gem('I am sorry, here is some prose instead of JSON'));
    send(200, gem(JSON.stringify(analysisJson())));
  });
});
await new Promise((r) => gserver.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${gserver.address().port}`;

// ---- start backend + client ----
const children = [];
const start = (cmd, args, cwd, env, logFile) => {
  const out = fs.openSync(logFile, 'w');
  const c = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', out, out] });
  children.push(c); return c;
};
const stop = (c) => { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* already gone */ } };
const waitFor = async (url, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if ((await fetch(url)).status < 500) return true; } catch { /* retry */ } await sleep(300); } throw new Error(`timeout waiting for ${url}`); };

const baseEnv = { NODE_ENV: 'development', PORT: '5000', MONGODB_URI: process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/placementprep_e2e', JWT_SECRET: 'e2e-secret-'.padEnd(48, 'x'), CLIENT_URL: 'http://localhost:5173', AI_RETRY_BASE_MS: '10', AI_QUOTA_PER_HOUR: '3' };
const aiEnv = { GEMINI_API_KEY: FAKE_KEY, LLM_MODEL: 'fake-flash', GEMINI_BASE_URL: FAKE_URL };
let backend = start('node', ['src/server.js'], `${ROOT}/server`, { ...baseEnv, ...aiEnv }, path.join(TMPDIR, 'backend1.log'));
const vite = start('npx', ['vite', '--host', '127.0.0.1'], `${ROOT}/client`, {}, path.join(TMPDIR, 'vite.log'));
await waitFor('http://127.0.0.1:5000/api/health');
await waitFor('http://127.0.0.1:5173/');

// ---- files to upload ----
fs.writeFileSync(path.join(TMPDIR, 'resume.pdf'), makePdf([RESUME_LINES]));
fs.writeFileSync(path.join(TMPDIR, 'fake.pdf'), 'This is a text file pretending to be a PDF. '.repeat(10));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--host-resolver-rules=MAP localhost 127.0.0.1'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + e));
const BASE = 'http://localhost:5173';
const alerts = () => page.$$eval('[role=alert]', (els) => els.map((e) => e.textContent.trim()));
const bodyText = () => page.$eval('body', (b) => b.innerText);
const setJd = async (text) => { await page.click('#jd'); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.type('#jd', text, { delay: 0 }); };
const submit = async () => {
  // A real user can only click an enabled button; the page briefly disables it while the AI status reloads.
  await page.waitForFunction(() => { const b = document.querySelector('form button[type=submit]'); return b && !b.disabled; }, { timeout: 8000 }).catch(() => console.log('  [probe] button never became enabled'));
  const probe = await page.$eval('form button[type=submit]', (b) => { b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { disabled: b.disabled, hit: el === b || b.contains(el) ? 'button' : (el?.tagName + ' ' + (el?.className ?? '').toString().slice(0, 60) + ' | ' + (el?.textContent ?? '').slice(0, 50)) }; });
  if (probe.disabled || probe.hit !== 'button') console.log('  [probe] before submit:', JSON.stringify(probe));
  await page.click('form button[type=submit]');
};
const waitReport = () => page.waitForFunction(() => /\/resume-analyzer\/[0-9a-f]{24}$/.test(location.pathname), { timeout: 30000 });
const waitAlertMatch = async (re) => { for (let i = 0; i < 60; i++) { if ((await alerts()).some((a) => re.test(a))) return true; await sleep(250); } return false; };

try {
  // 1. register
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle0' });
  await page.type('input[autocomplete=name]', 'Asha Rao');
  await page.type('input[type=email]', `e2e.${Date.now()}@example.com`);
  await page.type('input[type=password]', 'correct-horse-1');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Asha'));
  check(true, 'registered and on dashboard');
  await page.waitForFunction(() => document.body.innerText.includes('No scores recorded'), { timeout: 8000 }).catch(() => {});
  check((await bodyText()).includes('No scores recorded'), 'dashboard shows an empty state before any analysis (after its data loads)');

  // 2. consent gate
  await page.goto(`${BASE}/resume-analyzer`, { waitUntil: 'networkidle0' });
  check(!!(await page.$('#consent-title')), 'consent card is shown before AI consent');
  check(await page.$eval('form button[type=submit]', (b) => b.disabled), 'Analyse button is disabled without consent');
  await page.click('::-p-text(Allow AI processing)');
  await page.waitForFunction(() => !document.querySelector('#consent-title'));
  check(true, 'granting consent hides the card');

  // 3. upload: invalid then valid
  const input = await page.$('#resume-file');
  await input.uploadFile(path.join(TMPDIR, 'fake.pdf'));
  check(await waitAlertMatch(/not a valid PDF/i), 'a text file renamed .pdf is rejected with a clear message');
  await input.uploadFile(path.join(TMPDIR, 'resume.pdf'));
  await page.waitForSelector('input[type=radio]');
  check((await bodyText()).includes('resume.pdf'), 'valid PDF uploaded and listed');
  check(await page.$eval('input[type=radio]', (r) => r.checked), 'new resume is auto-selected');
  await input.uploadFile(path.join(TMPDIR, 'resume.pdf'));
  await sleep(800);
  check((await page.$$('input[type=radio]')).length === 1, 're-uploading the same resume does not create a duplicate');

  // 4. validation: JD too short keeps button disabled
  await setJd('too short');
  check(await page.$eval('form button[type=submit]', (b) => b.disabled), 'short job description keeps Analyse disabled');
  await page.screenshot({ path: path.join(OUT, 'analyzer.png'), fullPage: true });

  // 5. success path
  await setJd(JD);
  await submit();
  await waitReport();
  await page.waitForSelector('#score-title');
  const text = await bodyText();
  check(text.includes('Estimated match: 46 / 100'), 'report shows the deterministic score 46 / 100');
  check(text.includes('not a hiring probability'), 'report states the score is an estimate, not a hiring probability');
  for (const h of ['Demonstrated skills', 'Needs more evidence', 'Missing', 'Resume improvement suggestions', 'Preparation checklist', 'Potential interview questions']) check(text.includes(h), `report section: ${h}`);
  check(text.includes('Only add if true for you'), 'conditional suggestion is marked "only add if true for you"');
  check(text.includes('Built a library system in Java using Spring and MySQL'), 'evidence quote from the resume is displayed');
  check(!text.includes('Principal Java') && !text.includes('Led a team of 40'), 'fabricated highlight is not displayed');
  check(text.includes('fake-flash') && text.includes('resume-analysis@2'), 'provenance footer shows model and prompt version');
  check(text.includes('1 email address(es) and 1 phone number(s) were removed'), 'footer reports contact details removed before sending');
  await page.click('details summary');
  check((await bodyText()).includes('score = 100 x'), 'rubric explanation expands');
  await page.screenshot({ path: path.join(OUT, 'report.png'), fullPage: true });

  // 6. what actually went to the provider
  const sent = fake.requests.find((r) => r.url.includes('generateContent'))?.body ?? '';
  check(sent.length > 0 && !sent.includes('asha.rao@example.com') && !sent.includes('98765'), 'request to provider contains no email or phone number');
  check(sent.includes('[EMAIL]') && sent.includes('Built a library system'), 'request to provider still contains the useful resume content');
  check(sent.includes('responseJsonSchema') && sent.includes('"responseMimeType":"application/json"'), 'request asks for schema-constrained JSON');

  // 7. cache: same input again is free
  const before = fake.requests.length;
  await page.goto(`${BASE}/resume-analyzer`, { waitUntil: 'networkidle0' });
  await setJd(JD);
  await submit();
  await waitReport();
  check(fake.requests.length === before, 'repeating identical input served from saved result (no new provider call)');

  // 8. failure modes (each must show a clear message, no fake result, and not consume quota)
  const failure = async (mode, jdSuffix, re, label) => {
    fake.mode = mode; const n = fake.requests.length;
    await page.goto(`${BASE}/resume-analyzer`, { waitUntil: 'networkidle0' });
    await setJd(`${JD} ${jdSuffix}`); await submit();
    const shown = await waitAlertMatch(re);
    check(shown, `${label}: user sees a clear error`);
    check(page.url().endsWith('/resume-analyzer'), `${label}: no report was created`);
    return fake.requests.length - n;
  };
  const tries429 = await failure('rate_limit', 'RL', /rate limiting/i, 'provider 429');
  check(tries429 === 3, `provider 429: retried exactly twice then gave up (${tries429} requests, expected 3)`);
  const triesInvalid = await failure('invalid', 'INV', /could not validate/i, 'invalid AI output');
  check(triesInvalid === 2, `invalid AI output: one repair attempt then stopped (${triesInvalid} requests, expected 2)`);
  await failure('down', 'DOWN', /temporarily unavailable/i, 'provider 503');
  check((await bodyText()).includes('2 of 3 new analyses left'), 'failed attempts did not use up the hourly quota (1 real analysis used, 2 of 3 left)');
  fake.mode = 'ok';

  // 9. quota
  for (const s of ['Q1', 'Q2']) { await page.goto(`${BASE}/resume-analyzer`, { waitUntil: 'networkidle0' }); await setJd(`${JD} ${s}`); await submit(); await waitReport(); }
  await page.goto(`${BASE}/resume-analyzer`, { waitUntil: 'networkidle0' });
  await setJd(`${JD} Q3`); await submit();
  check(await waitAlertMatch(/allowed per hour/i), 'hourly quota message appears after the limit');

  // 10. history, delete analysis, delete resume
  await page.goto(`${BASE}/resume-analyzer`, { waitUntil: 'networkidle0' });
  const rows = (await page.$$('#history-title ~ div ul li')).length;
  check(rows === 3, `history lists the 3 saved analyses (${rows})`);
  await page.click('#history-title ~ div ul li button');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] button.border-bad\\/30');
  await page.waitForFunction(() => document.querySelectorAll('#history-title ~ div ul li').length === 2);
  check(true, 'deleting an analysis removes it from history');
  await page.click('button[aria-label^="Delete resume.pdf"]');
  await page.waitForSelector('dialog[open]');
  check((await page.$eval('dialog[open]', (d) => d.innerText)).includes('every analysis report made from it'), 'resume delete warns about cascading analyses');
  await page.click('dialog[open] button.border-bad\\/30');
  await page.waitForFunction(() => !document.querySelector('input[type=radio]'));
  await sleep(500);
  check((await bodyText()).includes('No analyses yet'), 'deleting the resume also removed its analyses');

  // 11. mobile
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/resume-analyzer`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(OUT, 'analyzer-mobile.png'), fullPage: false });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'analyzer has no horizontal overflow on mobile');
  await page.setViewport({ width: 1280, height: 900 });

  // 12. not configured
  stop(backend); await sleep(1000);
  backend = start('node', ['src/server.js'], `${ROOT}/server`, { ...baseEnv }, path.join(TMPDIR, 'backend2.log'));
  await waitFor('http://127.0.0.1:5000/api/health');
  await page.goto(`${BASE}/resume-analyzer`, { waitUntil: 'networkidle0' });
  check((await bodyText()).includes('AI is not set up on this server yet'), 'unconfigured server shows a setup message');
  check((await bodyText()).includes('npm run ai:check'), 'setup message points to ai:check');
  check(await page.$eval('form button[type=submit]', (b) => b.disabled), 'Analyse is disabled when AI is not configured');
  await page.screenshot({ path: path.join(OUT, 'unconfigured.png') });

  // 13. logs and console
  const log = fs.readFileSync(path.join(TMPDIR, 'backend1.log'), 'utf8') + fs.readFileSync(path.join(TMPDIR, 'backend2.log'), 'utf8');
  check(!log.includes(FAKE_KEY), 'server log does not contain the API key');
  check(!/asha\.rao@example|Spring and MySQL|98765/.test(log), 'server log does not contain resume content');
  const bad = consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of (400|401|403|404|413|422|429|502|503)/.test(e));
  check(bad.length === 0, `no unexpected browser console errors ${bad.length ? JSON.stringify(bad) : ''}`);
} catch (e) {
  fail++; console.log('FAIL  script error:', e.message); await page.screenshot({ path: path.join(OUT, 'error.png'), fullPage: true }).catch(() => {});
  console.log('visible alerts:', await alerts().catch(() => []));
} finally {
  await browser.close(); children.forEach(stop); gserver.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
