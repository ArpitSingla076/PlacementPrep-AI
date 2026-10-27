import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useFetch } from '../hooks/useFetch.js';
import { compareAnalyses } from '../services/analysisService.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { ScoreRing } from '../components/ScoreRing.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDate, humanize } from '../utils/format.js';

const CHANGE = {
  improved: { label: 'Improved', tone: 'ok' }, declined: { label: 'Declined', tone: 'bad' }, same: { label: 'No change', tone: 'neutral' },
  only_a: { label: 'Only in baseline', tone: 'warn' }, only_b: { label: 'New requirement', tone: 'warn' },
};
const level = (s) => (s ? humanize(s.evidenceLevel) : 'not a requirement');

function Report({ r, label }) {
  return (
    <div className="flex items-center gap-4 rounded-card border border-line bg-surface p-5">
      <ScoreRing value={r.score} size={92} />
      <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <Link to={`/resume-analyzer/${r.id}`} className="block truncate font-bold hover:underline">{r.roleTitle || 'Untitled role'}</Link>
        <p className="truncate text-xs text-muted">{r.resumeFilename} · {formatDate(r.createdAt)}</p></div>
    </div>
  );
}

export default function ComparePage() {
  const [params] = useSearchParams();
  const a = params.get('a'); const b = params.get('b');
  const { data: c, error, loading } = useFetch(() => compareAnalyses(a, b), [a, b]);
  const d = c?.summary.delta;

  return (
    <div>
      <Link to={b ? `/resume-analyzer/${b}` : '/resume-analyzer'} className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 hover:underline"><ArrowLeft className="size-4" aria-hidden="true" /> Back to report</Link>
      <h1 className="mt-4 text-3xl font-extrabold">Compare analyses</h1>
      <p className="mt-2 max-w-2xl text-muted">See what changed between two saved reports, for example the same job before and after you improved your resume. This is a direct comparison of saved results, with no AI involved.</p>
      {loading && <div className="mt-6 space-y-3"><Skeleton className="h-28" /><Skeleton className="h-48" /></div>}
      {error && <div className="mt-6"><Alert>{error.response?.status === 404 ? 'One of these reports was not found. It may have been deleted.' : getErrorMessage(error)}</Alert></div>}
      {c && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Report r={c.a} label="Baseline" /><Report r={c.b} label="Compared report" /></div>
          <section aria-labelledby="delta" className="rounded-panel border border-line bg-surface p-6">
            <h2 id="delta" className="flex items-center gap-2 text-lg font-bold">
              {d > 0 ? <ArrowUp className="size-5 text-ok" aria-hidden="true" /> : d < 0 ? <ArrowDown className="size-5 text-bad" aria-hidden="true" /> : <Minus className="size-5 text-muted" aria-hidden="true" />}
              {d === 0 ? 'No change in match score' : `Match score ${d > 0 ? 'up' : 'down'} by ${Math.abs(d)} points`} <span className="text-sm font-normal text-muted">({c.summary.scoreA} to {c.summary.scoreB})</span>
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
              <li><Badge tone="ok">{c.summary.improved} improved</Badge></li><li><Badge tone="bad">{c.summary.declined} declined</Badge></li><li><Badge>{c.summary.same} unchanged</Badge></li>
              {c.summary.onlyB > 0 && <li><Badge tone="warn">{c.summary.onlyB} new requirement{c.summary.onlyB === 1 ? '' : 's'}</Badge></li>}
              {c.summary.onlyA > 0 && <li><Badge tone="warn">{c.summary.onlyA} only in baseline</Badge></li>}
            </ul>
            <p className="mt-3 text-xs text-muted">Skills are matched by name. If the two reports used different job descriptions, differences in requirements are expected.</p>
          </section>
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <caption className="sr-only">Skill-by-skill comparison</caption>
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th scope="col" className="p-3">Skill</th><th scope="col" className="p-3">Baseline</th><th scope="col" className="p-3">Compared</th><th scope="col" className="p-3">Change</th></tr></thead>
              <tbody>{c.skills.map((s) => (
                <tr key={s.skill} className="border-b border-line last:border-0"><th scope="row" className="p-3 font-semibold">{s.skill} <span className="text-xs font-normal text-muted">{(s.b ?? s.a).importance}</span></th><td className="p-3 capitalize">{level(s.a)}</td><td className="p-3 capitalize">{level(s.b)}</td><td className="p-3"><Badge tone={CHANGE[s.change].tone}>{CHANGE[s.change].label}</Badge></td></tr>))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
