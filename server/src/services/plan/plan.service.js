import mongoose from 'mongoose';
import { PreparationPlan } from '../../models/PreparationPlan.js';
import { InterviewSession } from '../../models/InterviewSession.js';
import { JobAnalysis } from '../../models/JobAnalysis.js';
import { DocumentChunk } from '../../models/DocumentChunk.js';
import { KnowledgeDocument } from '../../models/KnowledgeDocument.js';
import { AppError } from '../../utils/AppError.js';
import { aiNotConfigured } from '../../ai/errors.js';
import { generateStructured } from '../../ai/structured.js';
import { planWritingSchema } from '../../ai/schemas/plan.schema.js';
import { PROMPT_VERSION, SYSTEM_INSTRUCTION, buildUserPrompt } from '../../ai/prompts/plan.v1.js';
import { topicStats, buildItems, carryCompletion } from './recommendations.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Documents of THIS user whose passages mention the topic: a deterministic text match, not a model guess. */
async function relatedDocuments(userId, topic) {
  const words = [...new Set(topic.toLowerCase().match(/[a-z0-9+#]{4,}/g) ?? [])].slice(0, 4);
  if (!words.length) return [];
  const ids = await DocumentChunk.distinct('documentId', { userId, text: { $regex: words.map(escapeRe).join('|'), $options: 'i' } });
  const docs = await KnowledgeDocument.find({ _id: { $in: ids.slice(0, 20) }, userId, status: 'ready' }).select('filename').limit(2);
  return docs.map((d) => ({ documentId: d._id, filename: d.filename }));
}

export async function generatePlan(user, { targetRole, jobAnalysisId }, { llm, quota, config }) {
  const userId = user._id;
  if (!llm.isConfigured) throw aiNotConfigured();

  // ---- 1. Gather REAL saved results
  const sessions = await InterviewSession.find({ userId, 'questions.evaluation': { $exists: true } }).sort({ createdAt: -1 }).limit(50);
  // The selected analysis if one was named (it must be this user's), otherwise the most recent one.
  const analysis = jobAnalysisId
    ? (mongoose.isValidObjectId(jobAnalysisId) ? await JobAnalysis.findOne({ _id: jobAnalysisId, userId }) : null)
    : await JobAnalysis.findOne({ userId }).sort({ createdAt: -1 });
  if (jobAnalysisId && !analysis) throw new AppError(404, 'NOT_FOUND', 'Resume analysis not found.');
  const stats = topicStats(sessions);
  const answered = [...stats.values()].reduce((n, t) => n + t.attempts, 0);
  if (answered === 0 && !analysis) {
    throw new AppError(409, 'NO_DATA', 'There is nothing to base a plan on yet. Complete a resume analysis or answer some mock interview questions first.');
  }

  // ---- 2. Deterministic items (which topics, priorities, evidence)
  let items = buildItems({ stats, analysis });
  if (items.length === 0) {
    throw new AppError(409, 'NOTHING_TO_RECOMMEND', answered
      ? 'Your saved results show no weak topics or skill gaps right now. Keep practising to keep it that way.'
      : 'Your latest resume analysis found no skill gaps to work on.');
  }
  const role = targetRole || analysis?.roleTitle || user.targetRoles?.[0] || 'Software engineer';

  // ---- 3. The model writes the study actions for exactly those items
  quota.consume(userId);
  let gen;
  try {
    gen = await generateStructured({
      provider: llm, systemInstruction: SYSTEM_INSTRUCTION, userPrompt: buildUserPrompt({ targetRole: role, items }),
      schema: planWritingSchema(items.map((i) => i.key)), temperature: 0.4,
      retries: config.retries, retryBaseMs: config.retryBaseMs, sleep: config.sleep,
    });
  } catch (err) { quota.refund(userId); throw err; }
  const written = new Map(gen.data.items.map((i) => [i.key, i]));

  items = await Promise.all(items.map(async (it) => ({
    ...it, action: written.get(it.key).action, practice: written.get(it.key).practice, relatedDocuments: await relatedDocuments(userId, it.topic), completed: false,
  })));

  // ---- 4. Keep earlier completion where still justified, then replace the single current plan
  const previous = await PreparationPlan.findOne({ userId });
  items = carryCompletion(items, previous?.items ?? []);

  const plan = await PreparationPlan.findOneAndUpdate({ userId }, {
    userId, targetRole: role, jobAnalysisId: analysis?._id, items, generatedAt: new Date(),
    basis: { interviewSessions: sessions.length, answeredQuestions: answered, analysisRole: analysis?.roleTitle, analysisScore: analysis?.score?.overall },
    ai: { model: llm.model, promptVersion: PROMPT_VERSION, promptTokens: gen.usage.promptTokens, outputTokens: gen.usage.outputTokens },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return toClient(plan, false);
}

/** `stale` = results saved after the plan was generated: the plan no longer reflects them. */
export async function getCurrentPlan(userId) {
  const plan = await PreparationPlan.findOne({ userId });
  if (!plan) return null;
  const [lastSession, lastAnalysis] = await Promise.all([
    InterviewSession.findOne({ userId, 'questions.evaluation': { $exists: true } }).sort({ updatedAt: -1 }).select('updatedAt'),
    JobAnalysis.findOne({ userId }).sort({ createdAt: -1 }).select('createdAt'),
  ]);
  const newest = Math.max(lastSession?.updatedAt?.getTime() ?? 0, lastAnalysis?.createdAt?.getTime() ?? 0);
  return toClient(plan, newest > plan.generatedAt.getTime());
}

export async function setItemCompleted(userId, key, completed) {
  const plan = await PreparationPlan.findOne({ userId });
  const item = plan?.items.find((i) => i.key === key);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Plan item not found.');
  item.completed = completed;
  item.completedAt = completed ? new Date() : undefined;
  item.completedAtAttempts = completed ? (item.observed?.attempts ?? 0) : undefined;
  if (completed) item.reopenedNote = undefined;
  await plan.save();
  return toClient(plan, false);
}

function toClient(plan, stale) {
  const o = plan.toObject();
  const done = o.items.filter((i) => i.completed).length;
  return { id: String(o._id), targetRole: o.targetRole, generatedAt: o.generatedAt, basis: o.basis, ai: { model: o.ai?.model, promptVersion: o.ai?.promptVersion }, stale,
    progress: { total: o.items.length, completed: done, percent: o.items.length ? Math.round((done / o.items.length) * 100) : 0 },
    items: o.items.map((i) => ({ ...i, relatedDocuments: i.relatedDocuments.map((d) => ({ documentId: String(d.documentId), filename: d.filename })) })) };
}
