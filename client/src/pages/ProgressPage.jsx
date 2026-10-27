import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFetch } from '../hooks/useFetch.js';
import { getProgress } from '../services/planService.js';
import { Alert } from '../components/ui/Alert.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { getErrorMessage } from '../utils/errors.js';
import { formatDate } from '../utils/format.js';

const CATEGORIES = ['Java and OOP', 'Data structures and algorithms', 'DBMS and SQL', 'Operating systems and computer networks', 'MERN and backend development', 'System design', 'Resume or job description based'];
const NAVY = '#13294b';
const short = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Card({ title, children, className = '' }) {
  return <section className={`rounded-card border border-line bg-surface p-5 ${className}`}><h2 className="text-sm font-bold">{title}</h2><div className="mt-4">{children}</div></section>;
}
function Stat({ label, value }) {
  return <div className="rounded-card border border-line bg-surface p-4"><dt className="text-xs font-semibold text-muted">{label}</dt><dd className="mt-1 text-2xl font-extrabold">{value}</dd></div>;
}
// Charts are drawn in SVG, so each gets a text alternative with the same numbers.
const Chart = ({ label, summary, children }) => <div role="img" aria-label={`${label}. ${summary}`} className="h-64 w-full"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;

export default function ProgressPage() {
  const [days, setDays] = useState('all');
  const [category, setCategory] = useState('');
  const { data: p, error, loading } = useFetch(() => getProgress({ days, ...(category && { category }) }), [days, category]);

  const filter = 'min-h-10 rounded-control border border-line bg-surface px-3 text-sm';
  const empty = p && p.counts.resumeAnalyses + p.counts.answeredQuestions === 0;

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Progress</h1>
      <p className="mt-2 max-w-2xl text-muted">Everything here is calculated from your saved analyses, interviews and plan. Nothing is estimated or filled in.</p>

      <div className="mt-6 flex flex-wrap gap-3">
        <label className="text-sm font-semibold">Time range <select value={days} onChange={(e) => setDays(e.target.value)} className={`${filter} ml-2`}><option value="all">All time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
        <label className="text-sm font-semibold">Interview category <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${filter} ml-2`}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      </div>

      {loading && <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>}
      {error && <div className="mt-6"><Alert>{getErrorMessage(error)}</Alert></div>}

      {p && (
        <div className="mt-6 space-y-6">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Resume analyses" value={p.counts.resumeAnalyses} />
            <Stat label="Interviews completed" value={p.counts.interviewsCompleted} />
            <Stat label="Questions answered" value={p.counts.answeredQuestions} />
            <Stat label="Quizzes taken" value={p.quizzes.completed} />
            <Stat label="Plan progress" value={p.plan ? `${p.plan.percent}%` : 'No plan'} />
          </dl>

          {empty && <div className="rounded-panel border border-line bg-surface p-8"><EmptyState title="No results in this view yet">Charts appear once you have saved results. <Link to="/resume-analyzer" className="font-semibold underline">Analyse a resume</Link> or <Link to="/interviews" className="font-semibold underline">start a mock interview</Link>. If you expected data, try a wider time range or all categories.</EmptyState></div>}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Recent job match scores">
              {p.matchScores.length === 0 ? <EmptyState title="No resume analyses">Match scores from your analyses will chart here.</EmptyState> : (
                <Chart label="Line chart of resume match scores over time" summary={p.matchScores.map((m) => `${short(m.date)}: ${m.score}`).join('; ')}>
                  <LineChart data={p.matchScores.map((m) => ({ ...m, label: short(m.date) }))} margin={{ left: -10, right: 10, top: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" /><XAxis dataKey="label" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} />
                    <Tooltip formatter={(v) => [`${v} / 100`, 'Match score']} labelFormatter={(l, items) => `${l}${items[0]?.payload.role ? ` · ${items[0].payload.role}` : ''}`} />
                    <Line type="monotone" dataKey="score" stroke={NAVY} strokeWidth={2.5} dot={{ r: 4 }} name="Match score" />
                  </LineChart>
                </Chart>
              )}
            </Card>

            <Card title="Mock interview average over time">
              {p.interviewTrend.length === 0 ? <EmptyState title="No completed interviews">Averages from completed interviews will chart here.</EmptyState> : (
                <Chart label="Line chart of interview averages" summary={p.interviewTrend.map((m) => `${short(m.date)} ${m.category}: ${m.average}`).join('; ')}>
                  <LineChart data={p.interviewTrend.map((m) => ({ ...m, label: short(m.date) }))} margin={{ left: -10, right: 10, top: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" /><XAxis dataKey="label" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} />
                    <Tooltip formatter={(v) => [`${v} / 100`, 'Average']} labelFormatter={(l, items) => `${l}${items[0]?.payload.category ? ` · ${items[0].payload.category}` : ''}`} />
                    <ReferenceLine y={p.thresholds.weakBelow} stroke="#a8341d" strokeDasharray="4 4" label={{ value: `weak < ${p.thresholds.weakBelow}`, fontSize: 11, fill: '#a8341d', position: 'insideBottomRight' }} />
                    <Line type="monotone" dataKey="average" stroke={NAVY} strokeWidth={2.5} dot={{ r: 4 }} name="Average" />
                  </LineChart>
                </Chart>
              )}
            </Card>
          </div>

          <Card title="Average score by topic">
            {p.topicAverages.length === 0 ? <EmptyState title="No topic scores yet">Topic averages come from answers you submit in mock interviews.</EmptyState> : (
              <Chart label="Bar chart of average score per topic" summary={p.topicAverages.map((t) => `${t.topic}: ${t.average} over ${t.attempts} answers`).join('; ')}>
                <BarChart data={p.topicAverages} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" horizontal={false} /><XAxis type="number" domain={[0, 100]} fontSize={12} /><YAxis type="category" dataKey="topic" width={110} fontSize={12} />
                  <Tooltip formatter={(v, _n, item) => [`${v} / 100 over ${item.payload.attempts} answer(s)`, 'Average']} />
                  <ReferenceLine x={p.thresholds.weakBelow} stroke="#a8341d" strokeDasharray="4 4" />
                  <Bar dataKey="average" fill={NAVY} radius={[0, 6, 6, 0]} name="Average" />
                </BarChart>
              </Chart>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Quiz scores over time">
              {p.quizzes.trend.length === 0 ? <EmptyState title="No quizzes taken">Scores from quizzes on your notes will chart here. <Link to="/quizzes" className="font-semibold underline">Create a quiz</Link>.</EmptyState> : (
                <Chart label="Line chart of quiz scores" summary={p.quizzes.trend.map((m) => `${short(m.date)}: ${m.percent}%`).join('; ')}>
                  <LineChart data={p.quizzes.trend.map((m) => ({ ...m, label: short(m.date) }))} margin={{ left: -10, right: 10, top: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ee" /><XAxis dataKey="label" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} />
                    <Tooltip formatter={(v) => [`${v}%`, 'Score']} /><Line type="monotone" dataKey="percent" stroke={NAVY} strokeWidth={2.5} dot={{ r: 4 }} name="Score" />
                  </LineChart>
                </Chart>
              )}
            </Card>
            <Card title="Quiz accuracy by topic">
              {p.quizzes.topics.length === 0 ? <p className="text-sm text-muted">Appears after you submit a quiz.</p> : (
                <ul className="space-y-2">{p.quizzes.topics.map((t) => <li key={t.topic} className="flex items-center justify-between gap-3 text-sm"><span>{t.topic} <span className="text-xs text-muted">({t.correct} of {t.total} correct)</span></span><Badge tone={t.percent >= 70 ? 'ok' : t.percent >= 40 ? 'warn' : 'bad'}>{t.percent}%</Badge></li>)}</ul>
              )}
            </Card>
          </div>

          <Card title="Applications">
            {Object.values(p.applications).every((n) => n === 0) ? <p className="text-sm text-muted">No applications tracked yet. <Link to="/applications" className="font-semibold underline">Add one</Link>.</p> : (
              <ul className="flex flex-wrap gap-3 text-sm">{Object.entries(p.applications).map(([k, n]) => <li key={k} className="rounded-control border border-line px-3 py-2"><span className="capitalize text-muted">{k}</span> <strong className="ml-1">{n}</strong></li>)}</ul>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Topics needing revision">
              {p.needsRevision.length === 0 ? <p className="text-sm text-muted">No topic is below {p.thresholds.weakBelow} with at least {p.thresholds.minAttempts} answers. A single low answer isn&apos;t counted as a weakness.</p> : (
                <ul className="space-y-2">{p.needsRevision.map((t) => <li key={t.topic} className="flex items-center justify-between gap-3 text-sm"><span>{t.topic} <span className="text-xs text-muted">({t.attempts} answers)</span>{t.repeated && <span className="ml-2"><Badge tone="bad">repeated</Badge></span>}</span><Badge tone="bad">{t.average}</Badge></li>)}</ul>
              )}
              <Link to="/preparation-plan" className="mt-4 inline-block text-sm font-semibold text-navy-800 underline underline-offset-4">Open your preparation plan</Link>
            </Card>

            <Card title="Recent activity">
              {p.recentActivity.length === 0 ? <p className="text-sm text-muted">Nothing yet in this view.</p> : (
                <ul className="space-y-2">{p.recentActivity.map((a) => (
                  <li key={`${a.type}${a.id}`}><Link to={a.type === 'analysis' ? `/resume-analyzer/${a.id}` : a.type === 'interview' ? `/interviews/${a.id}` : '/assistant'} className="flex items-center justify-between gap-3 rounded-control p-2 hover:bg-navy-50">
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{a.title}</span><span className="block text-xs text-muted">{a.detail} · {formatDate(a.date)}</span></span><Badge>{a.type}</Badge></Link></li>))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
