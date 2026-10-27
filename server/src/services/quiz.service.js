import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { QuizSession } from '../models/QuizSession.js';
import { KnowledgeDocument } from '../models/KnowledgeDocument.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { paginate } from '../utils/pagination.js';
import { aiNotConfigured } from '../ai/errors.js';
import { generateStructured } from '../ai/structured.js';
import { quizSchema } from '../ai/schemas/quiz.schema.js';
import { PROMPT_VERSION, SYSTEM_INSTRUCTION, buildUserPrompt } from '../ai/prompts/quiz.v1.js';
import { supportScore } from '../ai/rag/support.js';

const MIN_PASSAGE_CHARS = 150; // very short passages (headings, page numbers) make poor quiz material

/** Fisher-Yates with a cryptographic RNG. The SERVER decides where the right answer sits, not the model. */
function shuffled(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** What the client may see. Answers, explanations and sources stay hidden until the quiz is submitted. */
export function toClient(q) {
  const o = q.toObject ? q.toObject() : q;
  const done = o.status === 'completed';
  return {
    id: String(o._id), title: o.title, status: o.status, result: o.result, createdAt: o.createdAt, completedAt: o.completedAt, ai: { model: o.ai?.model },
    questions: o.questions.map((x, index) => ({
      index, question: x.question, options: x.options, topic: x.topic,
      ...(done && { correctIndex: x.correctIndex, selectedIndex: x.selectedIndex ?? null, correct: x.correct, explanation: x.explanation, weakGrounding: x.weakGrounding, source: x.source }),
    })),
  };
}

export async function createQuiz(user, { numQuestions, documentIds }, { llm, quota, config }) {
  const userId = user._id;
  if (!llm.isConfigured) throw aiNotConfigured();

  const filter = { userId, status: 'ready' };
  if (documentIds?.length) {
    if (!documentIds.every((id) => mongoose.isValidObjectId(id))) throw new AppError(404, 'NOT_FOUND', 'Document not found.');
    filter._id = { $in: documentIds };
  }
  const docs = await KnowledgeDocument.find(filter).select('filename');
  if (documentIds?.length && docs.length !== new Set(documentIds).size) throw new AppError(404, 'NOT_FOUND', 'One of the selected documents was not found or is not ready yet.');
  if (docs.length === 0) throw new AppError(409, 'NO_DOCUMENTS', 'Upload at least one PDF in Documents and wait until it is ready, then create a quiz.');
  if ((await QuizSession.countDocuments({ userId })) >= env.MAX_QUIZZES_PER_USER) throw new AppError(409, 'QUIZ_LIMIT_REACHED', `You can keep up to ${env.MAX_QUIZZES_PER_USER} quizzes. Delete some to create more.`);

  // Random passages from the user's own documents (ids first, so we do not load every passage's text).
  const names = new Map(docs.map((d) => [String(d._id), d.filename]));
  const ids = shuffled((await DocumentChunk.find({ userId, documentId: { $in: docs.map((d) => d._id) } }).select('_id').lean()).map((c) => c._id));
  const candidates = await DocumentChunk.find({ _id: { $in: ids.slice(0, numQuestions * 4) }, userId }).select('documentId text pageStart pageEnd').lean();
  const chosen = shuffled(candidates.filter((c) => c.text.length >= MIN_PASSAGE_CHARS)).slice(0, numQuestions);
  if (chosen.length === 0) throw new AppError(422, 'NOT_ENOUGH_TEXT', 'Your documents do not contain enough text passages to build a quiz from.');
  const sources = chosen.map((c, i) => ({ n: i + 1, chunk: c, filename: names.get(String(c.documentId)), text: c.text }));

  quota.consume(userId);
  let gen;
  try {
    gen = await generateStructured({
      provider: llm, systemInstruction: SYSTEM_INSTRUCTION, userPrompt: buildUserPrompt({ count: sources.length, sources }), schema: quizSchema(sources.length),
      temperature: 0.5, retries: config.retries, retryBaseMs: config.retryBaseMs, sleep: config.sleep,
    });
  } catch (err) { quota.refund(userId); throw err; }

  const questions = gen.data.questions.slice(0, sources.length).map((q) => {
    const src = sources[q.sourceN - 1];
    const correct = q.options[q.correctIndex];
    const options = shuffled(q.options);
    return {
      question: q.question, options, correctIndex: options.indexOf(correct), explanation: q.explanation, topic: q.topic,
      // Lexical check that the right answer and explanation actually share wording with the passage it claims to come from.
      weakGrounding: supportScore(`${q.explanation} ${correct}`, [src.text]) < 0.25,
      source: { chunkId: src.chunk._id, documentId: src.chunk.documentId, filename: src.filename, pageStart: src.chunk.pageStart, pageEnd: src.chunk.pageEnd, text: src.text },
    };
  });

  const quiz = await QuizSession.create({
    userId, title: [...new Set(sources.map((s) => s.filename))].slice(0, 2).join(', ') || 'Quiz', documentIds: docs.map((d) => d._id), questions,
    ai: { model: llm.model, promptVersion: PROMPT_VERSION, promptTokens: gen.usage.promptTokens, outputTokens: gen.usage.outputTokens },
  });
  return toClient(quiz);
}

async function load(userId, id) {
  const q = mongoose.isValidObjectId(id) ? await QuizSession.findOne({ _id: id, userId }) : null;
  if (!q) throw new AppError(404, 'NOT_FOUND', 'Quiz not found.');
  return q;
}

export const getQuiz = async (userId, id) => toClient(await load(userId, id));

export async function listQuizzes(userId, paging) {
  const { items, pagination } = await paginate(QuizSession, { userId }, paging);
  return { quizzes: items.map((q) => ({ id: String(q._id), title: q.title, status: q.status, total: q.questions.length, percent: q.result?.percent ?? null, createdAt: q.createdAt })), pagination };
}

export async function deleteQuiz(userId, id) {
  const { deletedCount } = mongoose.isValidObjectId(id) ? await QuizSession.deleteOne({ _id: id, userId }) : { deletedCount: 0 };
  if (!deletedCount) throw new AppError(404, 'NOT_FOUND', 'Quiz not found.');
}

/** Grading is plain code (no AI call): compare each chosen index with the stored correctIndex. A skipped question counts as wrong. */
export async function submitQuiz(userId, id, { answers }) {
  const quiz = await load(userId, id);
  if (quiz.status === 'completed') throw new AppError(409, 'QUIZ_COMPLETED', 'This quiz was already submitted.');
  if (answers.length !== quiz.questions.length) throw new AppError(400, 'VALIDATION_ERROR', `Send one answer per question (${quiz.questions.length}).`);
  quiz.questions.forEach((q, i) => {
    q.selectedIndex = answers[i] ?? undefined;
    q.correct = answers[i] === q.correctIndex;
  });
  const correct = quiz.questions.filter((q) => q.correct).length;
  quiz.result = { correct, total: quiz.questions.length, percent: Math.round((correct / quiz.questions.length) * 100) };
  quiz.status = 'completed';
  quiz.completedAt = new Date();
  await quiz.save();
  return toClient(quiz);
}
