import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, FileSearch, BookOpenText, MessagesSquare, ListChecks, Activity, ChartColumn, ArrowRight } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useFetch } from '../hooks/useFetch.js';
import { getProgress, getPlan } from '../services/planService.js';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { formatDate } from '../utils/format.js';
import { getErrorMessage } from '../utils/errors.js';

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Entry points from the product spec. Only the resume analyzer exists so far; the others are labelled, not faked.
const ACTIONS = [
  { label: 'Start a resume analysis', hint: 'Compare your resume with a job description.', icon: FileSearch, to: '/resume-analyzer' },
  { label: 'Ask a technical question', hint: 'Get answers from your own study notes.', icon: BookOpenText, to: '/assistant' },
  { label: 'Start a mock interview', hint: 'Practise questions and get scored feedback.', icon: MessagesSquare, to: '/interviews' },
];

function SetupStep({ done, to, title, children }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-start gap-3">
      <Icon className={`mt-0.5 size-5 shrink-0 ${done ? 'text-ok' : 'text-muted'}`} aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold">{title} <span className="sr-only">{done ? '(done)' : '(not done)'}</span></p>
        <p className="text-muted">{children} {!done && <Link to={to} className="font-semibold text-navy-800 underline underline-offset-4">Open settings</Link>}</p>
      </div>
    </li>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold"><Icon className="size-4 text-navy-700" aria-hidden="true" />{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PanelBody({ q, empty, isEmpty, children }) {
  if (q.loading) return <div className="space-y-2"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>;
  if (q.error) return <p role="alert" className="text-sm text-bad">{getErrorMessage(q.error)}</p>;
  if (isEmpty(q.data)) return empty;
  return children;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const progress = useFetch(() => getProgress({ days: 'all' }), []);
  const plan = useFetch(getPlan, []);
  const firstName = user.name.split(' ')[0];
  const hasRoles = user.targetRoles.length > 0;
  const hasConsent = user.preferences?.aiDataConsent?.given === true;
  const setupComplete = hasRoles && hasConsent;
  const p = progress.data;
  const priorities = (plan.data?.items ?? []).filter((i) => !i.completed).slice(0, 3);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-extrabold sm:text-4xl">{greeting()}, {firstName}</h1>
        <p className="mt-2 text-muted">{hasRoles ? <>Preparing for: {user.targetRoles.join(', ')}.</> : 'Tell us which roles you are preparing for to personalise your plan.'}</p>
      </header>

      <section aria-labelledby="start-heading">
        <h2 id="start-heading" className="sr-only">Start something</h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {ACTIONS.map(({ label, hint, icon: Icon, to, milestone }) => (
            <li key={label} className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-6">
              <Icon className="size-6 text-navy-700" aria-hidden="true" />
              <div><p className="font-bold">{label}</p><p className="mt-1 text-sm text-muted">{hint}</p></div>
              <div className="mt-auto">
                {to
                  ? <Link to={to} className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 hover:underline">Open <ArrowRight className="size-4" aria-hidden="true" /></Link>
                  : <Badge tone="warn">Available in Milestone {milestone}</Badge>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {!setupComplete && (
        <section aria-labelledby="setup-heading" className="rounded-panel border border-navy-100 bg-navy-50 p-6">
          <h2 id="setup-heading" className="text-lg font-bold">Finish setting up your account</h2>
          <ol className="mt-4 space-y-4">
            <SetupStep done={hasRoles} to="/settings" title="Add your target roles">Used to tailor interview questions and your preparation plan.</SetupStep>
            <SetupStep done={hasConsent} to="/settings" title="Decide whether AI features may process your content">AI features stay switched off until you allow it.</SetupStep>
          </ol>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Panel title="Preparation priorities" icon={ListChecks}>
          <PanelBody q={plan} isEmpty={(x) => !x || x.items.filter((i) => !i.completed).length === 0}
            empty={<EmptyState title="No priorities yet">Generate a <Link to="/preparation-plan" className="font-semibold underline">preparation plan</Link> from your analyses and interview results.</EmptyState>}>
            <ul className="space-y-1">{priorities.map((i) => (
              <li key={i.key}><Link to="/preparation-plan" className="flex items-center justify-between gap-3 rounded-control p-2 hover:bg-navy-50"><span className="truncate text-sm font-semibold">{i.topic}</span><Badge tone={i.priority === 'high' ? 'bad' : i.priority === 'medium' ? 'warn' : 'neutral'}>{i.priority}</Badge></Link></li>))}
            </ul>
          </PanelBody>
        </Panel>

        <Panel title="Recent activity" icon={Activity}>
          <PanelBody q={progress} isEmpty={(x) => x.recentActivity.length === 0} empty={<EmptyState title="Nothing to show yet">Your analyses, questions and interviews will be listed here.</EmptyState>}>
            <ul className="space-y-1">{p?.recentActivity.slice(0, 4).map((a) => (
              <li key={`${a.type}${a.id}`}><Link to={a.type === 'analysis' ? `/resume-analyzer/${a.id}` : a.type === 'interview' ? `/interviews/${a.id}` : '/assistant'} className="block rounded-control p-2 hover:bg-navy-50"><span className="block truncate text-sm font-semibold">{a.title}</span><span className="block text-xs text-muted">{a.detail} · {formatDate(a.date)}</span></Link></li>))}
            </ul>
          </PanelBody>
        </Panel>

        <Panel title="Progress summary" icon={ChartColumn}>
          <PanelBody q={progress} isEmpty={(x) => x.counts.resumeAnalyses + x.counts.answeredQuestions === 0} empty={<EmptyState title="No scores recorded">Scores come only from your saved analyses and interviews, so this stays empty until you complete one.</EmptyState>}>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Resume analyses</dt><dd className="font-bold">{p?.counts.resumeAnalyses}</dd></div>
              {p?.matchScores.length > 0 && <div className="flex justify-between"><dt className="text-muted">Latest match score</dt><dd className="font-bold">{p.matchScores.at(-1).score} / 100</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Interviews completed</dt><dd className="font-bold">{p?.counts.interviewsCompleted}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Topics needing revision</dt><dd className="font-bold">{p?.needsRevision.length}</dd></div>
            </dl>
            <Link to="/progress" className="mt-3 inline-block text-xs font-semibold text-navy-800 underline underline-offset-4">See all progress</Link>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
