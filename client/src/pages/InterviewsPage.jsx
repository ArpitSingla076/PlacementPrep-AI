import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { useFetch } from '../hooks/useFetch.js';
import { getAiStatus } from '../services/aiService.js';
import { createInterview, listInterviews, deleteInterview } from '../services/interviewService.js';
import { listAnalyses } from '../services/analysisService.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { ConsentCard } from '../components/ConsentCard.jsx';
import { SetupNotice, Code } from '../components/SetupNotice.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDate, scoreTone } from '../utils/format.js';

const CATEGORIES = ['Java and OOP', 'Data structures and algorithms', 'DBMS and SQL', 'Operating systems and computer networks', 'MERN and backend development', 'System design', 'Resume or job description based'];
const sel = 'mt-1.5 block min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm';

function Select({ label, value, onChange, options }) {
  return (
    <label className="block text-sm font-semibold">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={sel}>{options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}</select>
    </label>
  );
}

function History() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch(() => listInterviews(page, 6), [page]);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try { await deleteInterview(del.id); toast.success('Interview deleted.'); setDel(null); if (data.sessions.length === 1 && page > 1) setPage(page - 1); else reload(); }
    catch (err) { toast.error(getErrorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="iv-history" className="mt-12">
      <h2 id="iv-history" className="text-lg font-bold">Your interviews</h2>
      <div className="mt-4">
        {loading && <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
        {error && <Alert>{getErrorMessage(error)}</Alert>}
        {data?.sessions.length === 0 && <div className="rounded-card border border-line bg-surface p-5"><EmptyState title="No interviews yet">Start one above. Every answer and its feedback is saved so you can review it later.</EmptyState></div>}
        {data?.sessions.length > 0 && (
          <>
            <ul className="space-y-2">{data.sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 pr-2">
                <Link to={`/interviews/${s.id}`} className="flex min-w-0 flex-1 items-center gap-4 rounded-control p-1 hover:bg-navy-50">
                  {s.status === 'completed' ? <Badge tone={scoreTone(s.average)}>{s.average}/100</Badge> : <Badge tone="warn">In progress</Badge>}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{s.category}</span><span className="block truncate text-xs text-muted">{s.targetRole} · {s.difficulty} · {s.answered}/{s.total} answered · {formatDate(s.createdAt)}</span></span>
                  <ChevronRight className="size-4 text-muted" aria-hidden="true" />
                </Link>
                <button type="button" onClick={() => setDel(s)} aria-label={`Delete interview ${s.category}`} className="rounded-control p-2 text-muted hover:bg-bad-bg hover:text-bad"><Trash2 className="size-4" aria-hidden="true" /></button>
              </li>))}
            </ul>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
          </>
        )}
      </div>
      <ConfirmDialog open={!!del} title="Delete this interview?" loading={busy} onConfirm={confirm} onCancel={() => setDel(null)}>This interview, your answers and the feedback will be permanently deleted. Your progress charts will no longer include it.</ConfirmDialog>
    </section>
  );
}

export default function InterviewsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const consent = user.preferences?.aiDataConsent?.given === true;
  const status = useFetch(getAiStatus, [consent]);
  const analyses = useFetch(() => listAnalyses(1, 20), []);
  const [form, setForm] = useState({ targetRole: user.targetRoles[0] ?? '', experienceLevel: 'fresher', category: CATEGORIES[2], difficulty: 'medium', numQuestions: 5, jobDescription: '', jobAnalysisId: '' });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const configured = status.data?.configured;
  const canStart = consent && configured && form.targetRole.trim().length >= 2 && !running;

  const start = async (e) => {
    e.preventDefault(); setRunning(true); setError('');
    try {
      const body = { ...form, numQuestions: Number(form.numQuestions), jobDescription: form.jobDescription.trim() || undefined, jobAnalysisId: form.jobAnalysisId || undefined };
      const iv = await createInterview(body);
      navigate(`/interviews/${iv.id}`);
    } catch (err) { setError(getErrorMessage(err)); } finally { setRunning(false); }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Mock Interviews</h1>
      <p className="mt-2 max-w-2xl text-muted">Practise written technical questions one at a time and get structured feedback on correctness, completeness, relevance and clarity. Scores are AI-assisted estimates, computed from a fixed rubric.</p>
      <div className="mt-6 space-y-4">
        {status.data && !configured && <SetupNotice title="AI is not set up on this server yet"><p>The site owner needs <Code>GEMINI_API_KEY</Code> and <Code>LLM_MODEL</Code> in <Code>server/.env</Code>. Run <Code>npm run ai:check</Code>.</p></SetupNotice>}
        {!consent && <ConsentCard title="Before you start an interview">Your target role, any job description you add, and your written answers are sent to the AI provider (Google Gemini) to write questions and grade answers.</ConsentCard>}
      </div>

      <form onSubmit={start} className="mt-8 space-y-6 rounded-panel border border-line bg-surface p-6 sm:p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Target role" value={form.targetRole} onChange={(e) => set('targetRole')(e.target.value)} placeholder="e.g. Backend Developer" maxLength={100} required />
          <Select label="Experience level" value={form.experienceLevel} onChange={set('experienceLevel')} options={[{ value: 'intern', label: 'Intern' }, { value: 'fresher', label: 'Fresher (new graduate)' }, { value: 'junior', label: 'Junior (0 to 2 years)' }, { value: 'mid', label: 'Mid-level' }]} />
          <Select label="Category" value={form.category} onChange={set('category')} options={CATEGORIES} />
          <Select label="Difficulty" value={form.difficulty} onChange={set('difficulty')} options={['easy', 'medium', 'hard']} />
          <Select label="Number of questions" value={form.numQuestions} onChange={set('numQuestions')} options={[3, 5, 7, 10].map((n) => ({ value: n, label: `${n} questions` }))} />
          <Select label="Personalise from a resume analysis (optional)" value={form.jobAnalysisId} onChange={set('jobAnalysisId')}
            options={[{ value: '', label: 'None' }, ...(analyses.data?.analyses ?? []).map((a) => ({ value: a.id, label: `${a.roleTitle || 'Untitled role'} (${a.score.overall}/100)` }))]} />
        </div>
        <div>
          <label htmlFor="iv-jd" className="text-sm font-semibold">Job description (optional)</label>
          <textarea id="iv-jd" rows={4} value={form.jobDescription} maxLength={4000} onChange={(e) => set('jobDescription')(e.target.value)} placeholder="Paste a job description to focus the questions on it." className="mt-1.5 block w-full rounded-control border border-line p-3 text-sm" />
          <p className="mt-1 text-xs text-muted">If you personalise from a resume analysis, only the names of skills that need work are sent, never your resume text.</p>
        </div>
        <Alert>{error}</Alert>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" loading={running} disabled={!canStart}>{running ? 'Preparing questions…' : 'Start interview'}</Button>
          <p className="text-xs text-muted" aria-live="polite">{running ? 'Writing your questions. This usually takes 10 to 40 seconds.' : ''}</p>
        </div>
      </form>
      <History />
    </div>
  );
}
