import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';

const API = import.meta.env.VITE_API_URL || '/api';

/** Ask the server's health endpoint directly (bypassing every cache) and record what the browser actually experienced. */
async function probe() {
  const started = performance.now();
  try {
    const res = await fetch(`${API}/health?_t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(70_000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON: not our API */ }
    return { reached: true, status: res.status, json, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { reached: false, timeout: err?.name === 'TimeoutError', ms: Math.round(performance.now() - started) };
  }
}

function diagnose(r) {
  const origin = window.location.origin;
  if (!r.reached) {
    return r.timeout
      ? { tone: 'bad', title: 'The server did not answer within 70 seconds', tips: ['On free hosting the server sleeps when idle and can take a minute to wake: press "Keep trying" below.', 'If it never wakes, open the hosting dashboard (Render) and check the service status and its Logs.'] }
      : { tone: 'bad', title: 'The browser could not read any reply from the server', tips: ['The server may be asleep or restarting (free hosting). Press "Keep trying" below and wait up to a minute.', 'Or the server is blocking this website (CORS): the server\'s CLIENT_URL must contain ' + origin + '.', 'Or the API address built into this site is wrong (currently: ' + API + ').', 'Open the address above plus /health in a new tab. If it shows JSON there but not here, clear this site\'s data (Chrome: lock icon, Site settings, Clear data) and reload.'] };
  }
  const data = r.json?.data;
  if (!data) return { tone: 'bad', title: 'Something answered (HTTP ' + r.status + ') but it is not this app\'s server', tips: ['The API address may be wrong (currently: ' + API + '), or the hosting platform is showing its own page because the service is not running.', 'Check the hosting dashboard: the service should say Live, and its Logs should show "listening".'] };
  if (data.status !== 'ok') return { tone: 'warn', title: 'The server is running but cannot reach its database', tips: ['Check the database connection string and that the database allows connections from the server (Atlas: Network Access).'] };
  if (!(data.allowedOrigins ?? []).includes(origin)) return { tone: 'bad', title: 'The server is running, but it does not allow this website', tips: ['This website is ' + origin + '. The server allows: ' + (data.allowedOrigins ?? []).join(', ') + '.', 'On the hosting dashboard set CLIENT_URL to ' + origin + ' and wait for the redeploy.'] };
  return { tone: 'ok', title: 'Everything is connected', tips: ['The server answered in ' + r.ms + ' ms and allows this website. You can sign in or register now.'] };
}

const TONE = { ok: 'border-ok/40 bg-ok-bg', bad: 'border-bad/40 bg-bad-bg', warn: 'border-warn/40 bg-warn-bg' };

export default function StatusPage() {
  const [state, setState] = useState({ busy: true, result: null, tries: 1 });
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    probe().then((result) => { if (!cancelled.current) setState({ busy: false, result, tries: 1 }); });
    return () => { cancelled.current = true; };
  }, []);

  const run = async (keepTrying) => {
    setState((s) => ({ ...s, busy: true }));
    const limit = keepTrying ? 15 : 1;
    for (let i = 1; i <= limit && !cancelled.current; i++) {
      const result = await probe();
      if (cancelled.current) return;
      setState({ busy: i < limit && diagnose(result).tone !== 'ok', result, tries: i });
      if (diagnose(result).tone === 'ok') return;
      if (i < limit) await new Promise((r) => setTimeout(r, 5000));
    }
    setState((s) => ({ ...s, busy: false }));
  };

  const d = state.result ? diagnose(state.result) : null;
  const Icon = d?.tone === 'ok' ? CheckCircle2 : CircleAlert;

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-3xl font-extrabold">Connection check</h1>
      <p className="mt-2 text-sm text-muted">Tests whether this website can reach its server, and explains what is wrong if it cannot. No sign-in needed.</p>

      <dl className="mt-6 grid grid-cols-1 gap-3 rounded-card border border-line bg-surface p-4 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="font-semibold text-muted">This website</dt><dd className="break-all">{window.location.origin}</dd>
        <dt className="font-semibold text-muted">Server address</dt><dd className="break-all">{API.startsWith('http') ? API : window.location.origin + API + ' (forwarded to the server)'}</dd>
      </dl>

      <section aria-live="polite" className={`mt-6 rounded-card border p-5 ${d ? TONE[d.tone] : 'border-line bg-surface'}`}>
        {state.busy && !d && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Contacting the server. This can take up to a minute if it was asleep…</p>}
        {d && (
          <>
            <h2 className="flex items-start gap-2 text-base font-bold"><Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />{d.title}</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-6 text-sm">{d.tips.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-3 text-xs text-muted">Attempt {state.tries}{state.result.reached ? ', HTTP ' + state.result.status : ', no readable reply'}.</p>
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
