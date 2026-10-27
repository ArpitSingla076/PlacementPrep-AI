import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { useFetch } from '../hooks/useFetch.js';
import { getAiStatus } from '../services/aiService.js';
import { listDocuments } from '../services/documentService.js';
import { createQuiz, listQuizzes, deleteQuiz } from '../services/quizService.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { ConsentCard } from '../components/ConsentCard.jsx';
import { SetupNotice, Code } from '../components/SetupNotice.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDate, scoreTone } from '../utils/format.js';

function History() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch(() => listQuizzes(page, 6), [page]);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try { await deleteQuiz(del.id); toast.success('Quiz deleted.'); setDel(null); if (data.quizzes.length === 1 && page > 1) setPage(page - 1); else reload(); }
    catch (err) { toast.error(getErrorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="quiz-history" className="mt-12">
      <h2 id="quiz-history" className="text-lg font-bold">Your quizzes</h2>
      <div className="mt-4">
        {loading && <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
        {error && <Alert>{getErrorMessage(error)}</Alert>}
        {data?.quizzes.length === 0 && <div className="rounded-card border border-line bg-surface p-5"><EmptyState title="No quizzes yet">Create one above. Quizzes are built from passages of your own notes.</EmptyState></div>}
        {data?.quizzes.length > 0 && (
          <>
            <ul className="space-y-2">{data.quizzes.map((q) => (
              <li key={q.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 pr-2">
                <Link to={`/quizzes/${q.id}`} className="flex min-w-0 flex-1 items-center gap-4 rounded-control p-1 hover:bg-navy-50">
                  {q.status === 'completed' ? <Badge tone={scoreTone(q.percent)}>{q.percent}%</Badge> : <Badge tone="warn">Not taken</Badge>}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{q.title}</span><span className="block text-xs text-muted">{q.total} questions · {formatDate(q.createdAt)}</span></span>
                  <ChevronRight className="size-4 text-muted" aria-hidden="true" />
                </Link>
                <button type="button" onClick={() => setDel(q)} aria-label={`Delete quiz ${q.title}`} className="rounded-control p-2 text-muted hover:bg-bad-bg hover:text-bad"><Trash2 className="size-4" aria-hidden="true" /></button>
              </li>))}
            </ul>
            <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
          </>
        )}
      </div>
      <ConfirmDialog open={!!del} title="Delete this quiz?" loading={busy} onConfirm={confirm} onCancel={() => setDel(null)}>This quiz and its result will be permanently deleted.</ConfirmDialog>
    </section>
  );
}

export default function QuizzesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const consent = user.preferences?.aiDataConsent?.given === true;
  const status = useFetch(getAiStatus, [consent]);
  const docs = useFetch(() => listDocuments(1, 50), []);
  const [num, setNum] = useState(5);
  const [scope, setScope] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = (docs.data?.documents ?? []).filter((d) => d.status === 'ready');
  const canStart = consent && status.data?.configured && ready.length > 0 && !busy;

  const start = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const q = await createQuiz({ numQuestions: Number(num), documentIds: scope.length ? scope : undefined }); navigate(`/quizzes/${q.id}`); }
    catch (err) { setError(getErrorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Quizzes</h1>
      <p className="mt-2 max-w-2xl text-muted">Revise with multiple-choice questions written from passages of your own notes. Every question comes with the passage it was based on, so you can check it. Grading is exact and does not use AI.</p>
      <div className="mt-6 space-y-4">
        {status.data && !status.data.configured && <SetupNotice title="AI is not set up on this server yet"><p>The site owner needs <Code>GEMINI_API_KEY</Code> and <Code>LLM_MODEL</Code> in <Code>server/.env</Code>.</p></SetupNotice>}
        {!consent && <ConsentCard title="Before you create a quiz">Random passages from your notes are sent to the AI provider (Google Gemini) so it can write the questions.</ConsentCard>}
        {docs.data && ready.length === 0 && consent && <div className="rounded-panel border border-line bg-surface p-5 text-sm">You need at least one ready document first. <Link to="/documents" className="font-semibold text-navy-800 underline underline-offset-4">Upload your notes</Link>.</div>}
      </div>
      <form onSubmit={start} className="mt-8 space-y-6 rounded-panel border border-line bg-surface p-6 sm:p-8">
        <label className="block max-w-xs text-sm font-semibold">Number of questions
          <select value={num} onChange={(e) => setNum(e.target.value)} className="mt-1.5 block min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm">{[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n} questions</option>)}</select>
        </label>
        {ready.length > 1 && (
          <fieldset><legend className="text-sm font-semibold">Use these documents <span className="font-normal text-muted">(none selected = all)</span></legend>
            <div className="mt-2 flex flex-wrap gap-2">{ready.map((d) => <label key={d.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${scope.includes(d.id) ? 'border-navy-700 bg-navy-50 font-semibold' : 'border-line'}`}><input type="checkbox" className="sr-only" checked={scope.includes(d.id)} onChange={() => setScope((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]))} />{d.filename}</label>)}</div>
          </fieldset>
        )}
        <Alert>{error}</Alert>
        <div className="flex flex-wrap items-center gap-4"><Button type="submit" loading={busy} disabled={!canStart}>{busy ? 'Writing questions…' : 'Create quiz'}</Button><p className="text-xs text-muted" aria-live="polite">{busy ? 'Reading passages and writing questions. This usually takes 10 to 40 seconds.' : ''}</p></div>
      </form>
      <History />
    </div>
  );
}
