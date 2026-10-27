import mongoose from 'mongoose';
import { InterviewSession } from '../../models/InterviewSession.js';
import { JobAnalysis } from '../../models/JobAnalysis.js';
import { AppError } from '../../utils/AppError.js';
import { paginate } from '../../utils/pagination.js';
import { aiNotConfigured } from '../../ai/errors.js';
import { generateStructured } from '../../ai/structured.js';
import { interviewGenerationSchema, interviewEvaluationSchema } from '../../ai/schemas/interview.schema.js';
import * as P from '../../ai/prompts/interview.v1.js';
import { computeScores, aggregate } from './scoring.js';

export const CATEGORIES = ['Java and OOP', 'Data structures and algorithms', 'DBMS and SQL', 'Operating systems and computer networks', 'MERN and backend development', 'System design', 'Resume or job description based'];

const topicKey = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/** What the client may see. The rubric and model answer stay hidden until a question is answered (otherwise they would leak the answer). */
export function toClient(s) {
  const o = s.toObject ? s.toObject() : s;
  return {
    id: String(o._id), targetRole: o.targetRole, experienceLevel: o.experienceLevel, category: o.category, difficulty: o.difficulty,
    status: o.status, focusSkills: o.focusSkills, hasJobDescription: !!o.jobDescription, aggregate: o.aggregate, createdAt: o.createdAt, completedAt: o.completedAt, ai: o.ai,
    questions: o.questions.map((q, index) => {
      const answered = !!q.evaluation;
      return {
        index, question: q.question, topic: q.topic, difficulty: q.difficulty, answered,
        ...(answered && { answer: q.answer, keyPoints: q.keyPoints, evaluation: q.evaluation }),
      };
    }),
  };
}

export function toSummary(s) {
  const answered = s.questions.filter((q) => q.evaluation).length;
  return { id: String(s._id), targetRole: s.targetRole, category: s.category, difficulty: s.difficulty, status: s.status, answered, total: s.questions.length, average: s.aggregate?.average ?? null, createdAt: s.createdAt };
}

const requireReady = (llm) => { if (!llm.isConfigured) throw aiNotConfigured(); };

export async function createSession(user, input, { llm, quota, config }) {
  const userId = user._id;
  requireReady(llm);

  let focusSkills = [];
  if (input.jobAnalysisId) {
    const analysis = mongoose.isValidObjectId(input.jobAnalysisId) ? await JobAnalysis.findOne({ _id: input.jobAnalysisId, userId }) : null;
    if (!analysis) throw new AppError(404, 'NOT_FOUND', 'Resume analysis not found.');
    // Only skill NAMES that need work are sent: never the resume text or quotes.
    focusSkills = analysis.requirements.filter((r) => r.evidenceLevel !== 'demonstrated').sort((a, b) => b.weight - a.weight).slice(0, 8).map((r) => r.skill);
  }

  quota.consume(userId);
  let gen;
  try {
    gen = await generateStructured({
      provider: llm, systemInstruction: P.GENERATE_SYSTEM, schema: interviewGenerationSchema, temperature: 0.7,
      userPrompt: P.buildGenerateUser({ ...input, count: input.numQuestions, focusSkills }),
      retries: config.retries, retryBaseMs: config.retryBaseMs, sleep: config.sleep,
    });
  } catch (err) { quota.refund(userId); throw err; }

  const questions = gen.data.questions.slice(0, input.numQuestions).map((q) => ({ ...q, topicKey: topicKey(q.topic) }));
  const session = await InterviewSession.create({
    userId, targetRole: input.targetRole, experienceLevel: input.experienceLevel, category: input.category, difficulty: input.difficulty,
    requestedQuestions: input.numQuestions, jobDescription: input.jobDescription, jobAnalysisId: input.jobAnalysisId || undefined, focusSkills,
    questions, ai: { model: llm.model, promptVersion: P.GENERATE_VERSION },
  });
  return toClient(session);
}

async function load(userId, id) {
  const s = mongoose.isValidObjectId(id) ? await InterviewSession.findOne({ _id: id, userId }) : null;
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Interview not found.');
  return s;
}

export const getSession = async (userId, id) => toClient(await load(userId, id));
export async function listSessions(userId, paging) {
  const { items, pagination } = await paginate(InterviewSession, { userId }, paging);
  return { sessions: items.map(toSummary), pagination };
}
export async function deleteSession(userId, id) {
  const { deletedCount } = await InterviewSession.deleteOne({ _id: id, userId });
  if (!deletedCount) throw new AppError(404, 'NOT_FOUND', 'Interview not found.');
}

function finish(session) {
  session.status = 'completed';
  session.completedAt = new Date();
  session.aggregate = aggregate(session.questions);
}

export async function answerQuestion(userId, id, { questionIndex, answer }, { llm, quota, config }) {
  const session = await load(userId, id);
  if (session.status !== 'in_progress') throw new AppError(409, 'INTERVIEW_COMPLETED', 'This interview is already finished.');
  const q = session.questions[questionIndex];
  if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found.');
  if (q.evaluation) throw new AppError(409, 'ALREADY_ANSWERED', 'You already answered this question. Answers are final so scores stay comparable.');
  requireReady(llm);

  quota.consume(userId);
  let gen;
  try {
    gen = await generateStructured({
      provider: llm, systemInstruction: P.EVALUATE_SYSTEM, schema: interviewEvaluationSchema, temperature: 0,
      userPrompt: P.buildEvaluateUser({ question: q.question, keyPoints: q.keyPoints, answer }),
      retries: config.retries, retryBaseMs: config.retryBaseMs, sleep: config.sleep,
    });
  } catch (err) { quota.refund(userId); throw err; }

  const d = gen.data;
  const { covered, scores, overall, cappedCorrectness } = computeScores({ coveredPoints: d.coveredPoints, keyPointCount: q.keyPoints.length, correctness: d.correctness, relevance: d.relevance, clarity: d.clarity });
  q.answer = answer;
  q.answeredAt = new Date();
  q.evaluation = {
    scores, overall, coveredPoints: covered, whatWasCorrect: d.whatWasCorrect, missingOrIncorrect: d.missingOrIncorrect,
    strongerAnswer: d.strongerAnswer, followUp: d.followUp, cappedCorrectness,
    ai: { model: llm.model, promptVersion: P.EVALUATE_VERSION, promptTokens: gen.usage.promptTokens, outputTokens: gen.usage.outputTokens, repaired: gen.repaired },
  };
  if (session.questions.every((x) => x.evaluation)) finish(session);
  try { await session.save(); } catch (err) {
    quota.refund(userId);
    if (err?.name === 'VersionError') throw new AppError(409, 'ALREADY_ANSWERED', 'This question was just answered elsewhere. Reload the interview.');
    throw err;
  }
  return toClient(session);
}

export async function completeSession(userId, id) {
  const session = await load(userId, id);
  if (session.status === 'completed') return toClient(session);
  if (!session.questions.some((x) => x.evaluation)) throw new AppError(409, 'NOTHING_ANSWERED', 'Answer at least one question before finishing.');
  finish(session);
  await session.save();
  return toClient(session);
}
