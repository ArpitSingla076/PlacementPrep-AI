import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CircleAlert, Lightbulb, MessageCircleQuestion } from 'lucide-react';
import { useFetch } from '../hooks/useFetch.js';
import { useToast } from '../hooks/useToast.js';
import { getInterview, submitAnswer, completeInterview } from '../services/interviewService.js';
import { Button } from '../components/ui/Button.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ScoreBar } from '../components/ScoreBar.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDateTime, scoreTone } from '../utils/format.js';

function Feedback({ q }) {
  const e = q.evaluation;
  return (
    <div className="mt-5 space-y-5 rounded-card border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <Badge tone={scoreTone(e.overall)}>{e.overall} / 100</Badge>
        <p className="text-xs text-muted">AI-assisted estimate from a fixed rubric (correctness 40%, completeness 30%, relevance 15%, clarity 15%). Answer length is not scored.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{Object.entries(e.scores).map(([k, v]) => <ScoreBar key={k} label={k} value={v} />)}</div>
      {e.cappedCorrectness && <p className="rounded-control bg-warn-bg p-2.5 text-xs text-warn">Correctness was capped because your answer did not state any of the expected key ideas.</p>}

      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-bold"><CheckCircle2 className="size-4 text-ok" aria-hidden="true" /> What you got right</h4>
        {e.whatWasCorrect.length ? <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{e.whatWasCorrect.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="mt-1 text-sm text-muted">Nothing specific was identified.</p>}
      </div>
      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-bold"><CircleAlert className="size-4 text-warn" aria-hidden="true" /> Missing or incorrect</h4>
        {e.missingOrIncorrect.length ? <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{e.missingOrIncorrect.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="mt-1 text-sm text-muted">Nothing was flagged.</p>}
      </div>
      <div>
        <h4 className="text-sm font-bold">Key ideas a strong answer covers</h4>
        <ul className="mt-1.5 space-y-1 text-sm">{q.keyPoints.map((p, i) => <li key={p} className="flex items-start gap-2"><span className={`mt-0.5 text-xs font-bold ${e.coveredPoints[i] ? 'text-ok' : 'text-bad'}`}>{e.coveredPoints[i] ? 'Covered' : 'Missed'}</span><span>{p}</span></li>)}</ul>
      </div>
      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-bold"><Lightbulb className="size-4 text-navy-700" aria-hidden="true" /> A stronger answer</h4>
        <p className="mt-1.5 whitespace-pre-wrap rounded-control bg-navy-50 p-3 text-sm leading-relaxed">{e.strongerAnswer}</p>
      </div>
      {e.followUp && <p className="flex items-start gap-2 text-sm"><MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-navy-700" aria-hidden="true" /><span><strong>Follow-up to think about:</strong> {e.followUp}</span></p>}
    </div>
  );
}

function Summary({ iv }) {
  const a = iv.aggregate;
  return (
    <section aria-labelledby="sum" className="rounded-panel border border-line bg-surface p-6 sm:p-8">
      <h2 id="sum" className="text-lg font-bold">Results: {a.average} / 100 <span className="text-sm font-normal text-muted">across {a.answered} answered question{a.answered === 1 ? '' : 's'}</span></h2>
      <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-3"><h3 className="text-sm font-bold">By dimension</h3>{Object.entries(a.byDimension).map(([k, v]) => <ScoreBar key={k} label={k} value={v} />)}</div>
        <div><h3 className="text-sm font-bold">By topic</h3>
          <ul className="mt-3 space-y-2 text-sm">{a.byTopic.map((t) => <li key={t.topicKey} className="flex items-center justify-between gap-3"><span>{t.topic} <span className="text-xs text-muted">({t.count})</span></span><Badge tone={scoreTone(t.average)}>{t.average}</Badge></li>)}</ul>
          <p className="mt-3 text-xs text-muted">Topic trends across interviews are on the <Link to="/progress" className="font-semibold underline">Progress</Link> page, and your <Link to="/preparation-plan" className="font-semibold underline">Preparation Plan</Link> updates from these results.</p>
        </div>
      </div>
    </section>
  );
}

export default function InterviewSessionPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: iv, error, loading, reload } = useFetch(() => getInterview(id), [id]);
  const [current, setCurrent] = useState(null); // which question the user is viewing
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const firstOpen = iv ? iv.questions.findIndex((q) => !q.answered) : -1;
  const index = current ?? (firstOpen === -1 ? 0 : firstOpen);
  const q = iv?.questions[index];
  const done = iv?.status === 'completed';

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const updated = await submitAnswer(id, { questionIndex: index, answer }); setAnswer(''); setCurrent(index); toast.success(updated.status === 'completed' ? 'Interview complete. Results are ready.' : 'Answer evaluated.'); reload(); }
    catch (e2) { setErr(getErrorMessage(e2)); } finally { setBusy(false); }
  };
  const finishEarly = async () => {
    setBusy(true); setErr('');
    try { await completeInterview(id); reload(); } catch (e2) { setErr(getErrorMessage(e2)); } finally { setBusy(false); }
  };
  const goNext = () => { const n = iv.questions.findIndex((x, i) => i > index && !x.answered); setCurrent(n === -1 ? iv.questions.findIndex((x) => !x.answered) : n); };

  return (
    <div>
      <Link to="/interviews" className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 hover:underline"><ArrowLeft className="size-4" aria-hidden="true" /> All interviews</Link>
      {loading && <div className="mt-6 space-y-3"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-48" /></div>}
      {error && <div className="mt-6 rounded-panel border border-line bg-surface p-8"><EmptyState title={error.response?.status === 404 ? 'Interview not found' : 'Could not load this interview'}>{error.response?.status === 404 ? 'It may have been deleted.' : getErrorMessage(error)}</EmptyState></div>}
      {iv && (
        <>
          <header className="mt-4">
            <h1 className="text-3xl font-extrabold">{iv.category}</h1>
            <p className="mt-1 text-sm text-muted">{iv.targetRole} · {iv.experienceLevel} · {iv.difficulty} · started {formatDateTime(iv.createdAt)}</p>
            {iv.focusSkills.length > 0 && <p className="mt-1 text-xs text-muted">Focused on: {iv.focusSkills.join(', ')}</p>}
          </header>

          {done && <div className="mt-6"><Summary iv={iv} /></div>}

          <nav aria-label="Questions" className="mt-6 flex flex-wrap gap-2">
            {iv.questions.map((x, i) => (
              <button key={i} type="button" onClick={() => { setCurrent(i); setErr(''); }} aria-current={i === index} aria-label={`Question ${i + 1}${x.answered ? ', answered' : ''}`}
                className={`size-10 rounded-control border text-sm font-bold ${i === index ? 'border-navy-900 bg-navy-900 text-white' : x.answered ? 'border-ok/40 bg-ok-bg text-ok' : 'border-line bg-surface hover:bg-navy-50'}`}>{i + 1}</button>
            ))}
          </nav>

          <section aria-labelledby="qtitle" className="mt-4 rounded-panel border border-line bg-surface p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Question {index + 1} of {iv.questions.length} · {q.topic} · {q.difficulty}</p>
            <h2 id="qtitle" className="mt-2 text-lg font-bold leading-snug">{q.question}</h2>

            {q.answered ? (
              <>
                <div className="mt-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">Your answer</p><p className="mt-1 whitespace-pre-wrap rounded-control bg-canvas p-3 text-sm">{q.answer}</p></div>
                <Feedback q={q} />
                {!done && iv.questions.some((x) => !x.answered) && <Button className="mt-5" onClick={goNext}>Next question</Button>}
              </>
            ) : done ? (
              <p className="mt-4 text-sm text-muted">You finished the interview without answering this question.</p>
            ) : (
              <form onSubmit={submit} className="mt-4">
                <label htmlFor="ans" className="text-sm font-semibold">Your answer</label>
                <textarea id="ans" rows={8} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={4500} placeholder="Explain in your own words. Correct, clear and relevant beats long." className="mt-1.5 block w-full rounded-control border border-line p-3 text-sm leading-relaxed" />
                <p className="mt-1 text-xs text-muted">{answer.trim().length} characters. Answers are final once submitted, so scores stay comparable over time.</p>
                <div className="mt-3"><Alert>{err}</Alert></div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button type="submit" loading={busy} disabled={answer.trim().length < 10}>{busy ? 'Evaluating…' : 'Submit answer'}</Button>
                  {iv.questions.some((x) => x.answered) && <Button variant="secondary" onClick={finishEarly} disabled={busy}>Finish interview now</Button>}
                  <span className="text-xs text-muted" aria-live="polite">{busy ? 'Grading your answer against the rubric…' : ''}</span>
                </div>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
