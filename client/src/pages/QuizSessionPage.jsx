import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';
import { useFetch } from '../hooks/useFetch.js';
import { getQuiz, submitQuiz } from '../services/quizService.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { scoreTone } from '../utils/format.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const pages = (s) => (s.pageStart === s.pageEnd ? `page ${s.pageStart}` : `pages ${s.pageStart}-${s.pageEnd}`);

function Review({ q }) {
  return (
    <div className="mt-4 space-y-2">
      <ul className="space-y-2">{q.options.map((o, i) => {
        const right = i === q.correctIndex; const picked = i === q.selectedIndex;
        return (
          <li key={i} className={`flex items-start gap-2.5 rounded-control border p-3 text-sm ${right ? 'border-ok/40 bg-ok-bg' : picked ? 'border-bad/40 bg-bad-bg' : 'border-line'}`}>
            {right ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" /> : picked ? <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden="true" /> : <span className="mt-0.5 size-4 shrink-0" />}
            <span><strong>{LETTERS[i]}.</strong> {o}{right && <span className="ml-2 text-xs font-semibold text-ok">correct answer</span>}{picked && !right && <span className="ml-2 text-xs font-semibold text-bad">your answer</span>}</span>
          </li>
        );
      })}</ul>
      {q.selectedIndex === null && <p className="text-xs font-semibold text-warn">You skipped this question.</p>}
      <p className="text-sm"><strong>Why:</strong> {q.explanation}</p>
      {q.weakGrounding && <p className="flex items-center gap-1.5 text-xs font-medium text-warn"><ShieldAlert className="size-3.5" aria-hidden="true" />This answer shares little wording with the source passage. Check it against your notes.</p>}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-navy-800">Source: {q.source.filename}, {pages(q.source)}</summary>
        {q.source.documentDeleted ? <p className="mt-2 text-xs text-muted">This document was deleted, so the passage is no longer stored.</p> : <blockquote className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-control border-l-2 border-navy-700 bg-navy-50 p-3 text-xs leading-relaxed">{q.source.text}</blockquote>}
      </details>
    </div>
  );
}

export default function QuizSessionPage() {
  const { id } = useParams();
  const { data: quiz, error, loading, reload } = useFetch(() => getQuiz(id), [id]);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const done = quiz?.status === 'completed';

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await submitQuiz(id, quiz.questions.map((_, i) => answers[i] ?? null)); reload(); }
    catch (e2) { setErr(getErrorMessage(e2)); } finally { setBusy(false); }
  };

  return (
    <div>
      <Link to="/quizzes" className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 hover:underline"><ArrowLeft className="size-4" aria-hidden="true" /> All quizzes</Link>
      {loading && <div className="mt-6 space-y-3"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40" /></div>}
      {error && <div className="mt-6 rounded-panel border border-line bg-surface p-8"><EmptyState title={error.response?.status === 404 ? 'Quiz not found' : 'Could not load this quiz'}>{error.response?.status === 404 ? 'It may have been deleted.' : getErrorMessage(error)}</EmptyState></div>}
      {quiz && (
        <>
          <header className="mt-4"><h1 className="text-3xl font-extrabold">{quiz.title}</h1><p className="mt-1 text-sm text-muted">{quiz.questions.length} questions from your notes</p></header>
          {done && <section aria-labelledby="qres" className="mt-6 rounded-panel border border-line bg-surface p-6"><h2 id="qres" className="text-lg font-bold">Score: {quiz.result.correct} of {quiz.result.total} <Badge tone={scoreTone(quiz.result.percent)}>{quiz.result.percent}%</Badge></h2><p className="mt-1 text-xs text-muted">Graded exactly against the stored answers. No AI is used to mark.</p></section>}

          <form onSubmit={submit} className="mt-6 space-y-5">
            {quiz.questions.map((q, i) => (
              <fieldset key={i} className="rounded-panel border border-line bg-surface p-6" disabled={done}>
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Question {i + 1} · {q.topic}</legend>
                <p className="text-base font-bold leading-snug">{q.question}</p>
                {done ? <Review q={q} /> : (
                  <ul className="mt-4 space-y-2">{q.options.map((o, j) => (
                    <li key={j}><label className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 text-sm ${answers[i] === j ? 'border-navy-700 bg-navy-50' : 'border-line hover:bg-navy-50/60'}`}>
                      <input type="radio" name={`q${i}`} checked={answers[i] === j} onChange={() => setAnswers((a) => ({ ...a, [i]: j }))} className="mt-0.5 size-4 accent-navy-900" /><span><strong>{LETTERS[j]}.</strong> {o}</span>
                    </label></li>))}
                  </ul>
                )}
              </fieldset>
            ))}
            {!done && (
              <div><Alert>{err}</Alert>
                <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="submit" loading={busy}>Submit quiz</Button><span className="text-xs text-muted">{Object.keys(answers).length} of {quiz.questions.length} answered. Unanswered questions count as wrong.</span></div>
              </div>
            )}
          </form>
        </>
      )}
    </div>
  );
}
