import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleAlert, CircleMinus, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { diagnoseConnection } from '../utils/connectionDiagnosis.js';

const API = import.meta.env.VITE_API_URL || '/api';
const DIRECT = /^https?:\/\//.test(API);
const TIMEOUT = 70_000;

/** One health request. The "_t" tag defeats any cache. mode 'no-cors' succeeds for ANY reply, even one the browser may not read. */
async function probe(url, mode = 'cors') {
  const started = performance.now();
  try {
    const res = await fetch(`${url}?_t=${Date.now()}`, { cache: 'no-store', mode, signal: AbortSignal.timeout(TIMEOUT) });
    if (mode === 'no-cors') return { reached: true, opaque: true, ms: Math.round(performance.now() - started) };
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON: not this app */ }
    return { reached: true, status: res.status, json, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { reached: false, timeout: err?.name === 'TimeoutError', ms: Math.round(performance.now() - started) };
  }
}

async function runChecks() {
  const [direct, noCors, proxy] = await Promise.all([
    DIRECT ? probe(`${API}/health`) : probe('/api/health'),
    DIRECT ? probe(`${API}/health`, 'no-cors') : Promise.resolve(undefined),
    probe('/api/health'),
  ]);
  return diagnoseConnection({ origin: window.location.origin, api: API, direct, noCors, proxy });
}

const TONE = { ok: 'border-ok/40 bg-ok-bg', bad: 'border-bad/40 bg-bad-bg', warn: 'border-warn/40 bg-warn-bg' };
const STATE = { ok: [CheckCircle2, 'text-ok', 'worked'], fail: [CircleAlert, 'text-bad', 'failed'], skip: [CircleMinus, 'text-muted', 'skipped'] };

export default function StatusPage() {
  const [state, setState] = useState({ busy: true, diag: null, tries: 1 });
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    runChecks().then((diag) => { if (!cancelled.current) setState({ busy: false, diag, tries: 1 }); });
    return () => { cancelled.current = true; };
  }, []);

  const run = async (keepTrying) => {
    setState((s) => ({ ...s, busy: true }));
    const limit = keepTrying ? 15 : 1;
    for (let i = 1; i <= limit && !cancelled.current; i++) {
      const diag = await runChecks();
      if (cancelled.current) return;
      setState({ busy: i < limit && diag.tone !== 'ok', diag, tries: i });
      if (diag.tone === 'ok') return;
      if (i < limit) await new Promise((r) => setTimeout(r, 5000));
    }
    setState((s) => ({ ...s, busy: false }));
  };

  const d = state.diag;
  const Icon = d?.tone === 'ok' ? CheckCircle2 : CircleAlert;

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-3xl font-extrabold">Connection check</h1>
      <p className="mt-2 text-sm text-muted">Tests three ways this website can reach its server, and explains what is wrong. No sign-in needed.</p>

      <dl className="mt-6 grid grid-cols-1 gap-3 rounded-card border border-line bg-surface p-4 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="font-semibold text-muted">This website</dt><dd className="break-all">{window.location.origin}</dd>
        <dt className="font-semibold text-muted">Server address</dt><dd className="break-all">{DIRECT ? API : window.location.origin + API + ' (forwarded to the server by this site)'}</dd>
      </dl>

      <section aria-live="polite" className={`mt-6 rounded-card border p-5 ${d ? TONE[d.tone] : 'border-line bg-surface'}`}>
        {state.busy && !d && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Contacting the server. This can take up to a minute if it was asleep…</p>}
        {d && (
          <>
            <h2 className="flex items-start gap-2 text-base font-bold"><Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />{d.title}</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-6 text-sm">{d.tips.map((t) => <li key={t}>{t}</li>)}</ul>
            <ul className="mt-4 space-y-1.5 border-t border-black/10 pt-3 text-sm" aria-label="Individual checks">
              {d.checks.map((c) => { const [CIcon, color, word] = STATE[c.state]; return (
                <li key={c.name} className="flex items-start gap-2"><CIcon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden="true" /><span><strong>{c.name}:</strong> <span className="sr-only">{word}. </span>{c.detail}</span></li>
              ); })}
            </ul>
            <p className="mt-3 text-xs text-muted">Attempt {state.tries}.</p>
          </>
        )}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={() => run(false)} variant="secondary" disabled={state.busy}><RefreshCw className="size-4" aria-hidden="true" />Check again</Button>
        <Button onClick={() => run(true)} disabled={state.busy} loading={state.busy && !!d}>Keep trying for 90 seconds</Button>
        <Link to="/login" className="text-sm font-semibold text-navy-800 underline underline-offset-4">Back to sign in</Link>
      </div>
    </div>
  );
}
