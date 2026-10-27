import { JobAnalysis } from '../models/JobAnalysis.js';
import { InterviewSession } from '../models/InterviewSession.js';
import { KnowledgeDocument } from '../models/KnowledgeDocument.js';
import { ChatConversation } from '../models/ChatConversation.js';
import { PreparationPlan } from '../models/PreparationPlan.js';
import { QuizSession } from '../models/QuizSession.js';
import { JobApplication, APPLICATION_STATUSES } from '../models/JobApplication.js';
import { topicStats, WEAK_BELOW, MIN_ATTEMPTS } from './plan/recommendations.js';

/** Every number here is computed from saved records for THIS user. Nothing is estimated, defaulted or invented. */
export async function getProgress(userId, { days, category }) {
  const since = days ? new Date(Date.now() - days * 86_400_000) : null;
  const inWindow = since ? { createdAt: { $gte: since } } : {};
  const sessionFilter = { userId, ...inWindow, ...(category && { category }) };

  const [analyses, sessions, documents, conversations, plan, quizzes, applications] = await Promise.all([
    JobAnalysis.find({ userId, ...inWindow }).sort({ createdAt: 1 }).select('roleTitle score.overall createdAt'),
    InterviewSession.find(sessionFilter).sort({ createdAt: 1 }),
    KnowledgeDocument.countDocuments({ userId }),
    ChatConversation.find({ userId, ...(since && { updatedAt: { $gte: since } }) }).select('title updatedAt').sort({ updatedAt: -1 }).limit(5),
    PreparationPlan.findOne({ userId }).select('items generatedAt'),
    QuizSession.find({ userId, status: 'completed', ...(since && { completedAt: { $gte: since } }) }).select('questions.topic questions.correct result completedAt').sort({ completedAt: 1 }),
    JobApplication.find({ userId }).select('status'),
  ]);

  const stats = [...topicStats(sessions).values()];
  const completed = sessions.filter((s) => s.status === 'completed');
  const byCategory = new Map();
  for (const s of completed) { const c = byCategory.get(s.category) ?? { category: s.category, sessions: 0, sum: 0 }; c.sessions++; c.sum += s.aggregate?.average ?? 0; byCategory.set(s.category, c); }

  const activity = [
    ...analyses.map((a) => ({ type: 'analysis', id: String(a._id), title: a.roleTitle || 'Resume analysis', detail: `Match score ${a.score?.overall ?? 0}/100`, date: a.createdAt })),
    ...sessions.map((s) => ({ type: 'interview', id: String(s._id), title: `${s.category} interview`, detail: s.status === 'completed' ? `Average ${s.aggregate?.average ?? 0}/100` : 'In progress', date: s.createdAt })),
    ...conversations.map((c) => ({ type: 'question', id: String(c._id), title: c.title, detail: 'Assistant conversation', date: c.updatedAt })),
  ].sort((a, b) => b.date - a.date).slice(0, 8);

  // Quiz accuracy per topic: correct answers / questions answered, across completed quizzes in the window.
  const quizTopics = new Map();
  for (const quiz of quizzes) for (const q of quiz.questions) {
    const t = quizTopics.get(q.topic) ?? { topic: q.topic, correct: 0, total: 0 };
    t.total += 1; if (q.correct) t.correct += 1; quizTopics.set(q.topic, t);
  }

  const done = plan?.items.filter((i) => i.completed).length ?? 0;
  return {
    filters: { days: days ?? 'all', category: category ?? null },
    counts: {
      resumeAnalyses: analyses.length, interviewsCompleted: completed.length, interviewsInProgress: sessions.length - completed.length,
      answeredQuestions: stats.reduce((n, t) => n + t.attempts, 0), documents,
    },
    matchScores: analyses.slice(-20).map((a) => ({ id: String(a._id), date: a.createdAt, role: a.roleTitle, score: a.score?.overall ?? 0 })),
    interviewTrend: completed.slice(-20).map((s) => ({ id: String(s._id), date: s.createdAt, category: s.category, average: s.aggregate?.average ?? 0 })),
    topicAverages: stats.map((t) => ({ topic: t.topic, topicKey: t.topicKey, average: t.average, attempts: t.attempts })).sort((a, b) => a.average - b.average),
    needsRevision: stats.filter((t) => t.average < WEAK_BELOW && t.attempts >= MIN_ATTEMPTS).map((t) => ({ topic: t.topic, average: t.average, attempts: t.attempts, repeated: t.sessionsBelow >= 2 })),
    byCategory: [...byCategory.values()].map((c) => ({ category: c.category, sessions: c.sessions, average: Math.round(c.sum / c.sessions) })),
    quizzes: {
      completed: quizzes.length,
      average: quizzes.length ? Math.round(quizzes.reduce((s, q) => s + (q.result?.percent ?? 0), 0) / quizzes.length) : null,
      trend: quizzes.slice(-20).map((q) => ({ id: String(q._id), date: q.completedAt, percent: q.result?.percent ?? 0 })),
      topics: [...quizTopics.values()].map((t) => ({ ...t, percent: Math.round((t.correct / t.total) * 100) })).sort((a, b) => a.percent - b.percent),
    },
    applications: Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, applications.filter((a) => a.status === s).length])),
    plan: plan ? { total: plan.items.length, completed: done, percent: plan.items.length ? Math.round((done / plan.items.length) * 100) : 0, generatedAt: plan.generatedAt } : null,
    recentActivity: activity,
    thresholds: { weakBelow: WEAK_BELOW, minAttempts: MIN_ATTEMPTS },
  };
}
