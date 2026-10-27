import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Resume } from '../models/Resume.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { KnowledgeDocument } from '../models/KnowledgeDocument.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { ChatConversation } from '../models/ChatConversation.js';
import { InterviewSession } from '../models/InterviewSession.js';
import { PreparationPlan } from '../models/PreparationPlan.js';
import { JobApplication } from '../models/JobApplication.js';
import { QuizSession } from '../models/QuizSession.js';
import { USER_OWNED_MODELS } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { waitForIngestion } from './knowledge/ingestion.service.js';
import { invalidateAllSessions } from './auth.service.js';

async function verifyPassword(userId, password) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(403, 'WRONG_PASSWORD', 'That password is not correct.');
  }
  return user;
}

/** Changing the password signs out every OTHER device (tokenVersion), and the caller gets a fresh session. */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await verifyPassword(userId, currentPassword);
  if (currentPassword === newPassword) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a new password that is different from the current one.', [{ field: 'newPassword', message: 'Must differ from the current password.' }]);
  user.passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await user.save();
  await invalidateAllSessions(userId);
  return User.findById(userId).select('+tokenVersion');
}

/** Everything the app stores about the user, as plain JSON (vectors excluded: they are derived numbers, not content). */
export async function exportData(userId) {
  const [user, resumes, analyses, documents, chunks, conversations, interviews, plan, applications, quizzes] = await Promise.all([
    User.findById(userId),
    Resume.find({ userId }).select('+extractedText').lean(),
    JobAnalysis.find({ userId }).lean(),
    KnowledgeDocument.find({ userId }).select('-contentHash').lean(),
    DocumentChunk.find({ userId }).select('documentId chunkIndex pageStart pageEnd text').sort({ documentId: 1, chunkIndex: 1 }).lean(),
    ChatConversation.find({ userId }).lean(),
    InterviewSession.find({ userId }).lean(),
    PreparationPlan.findOne({ userId }).lean(),
    JobApplication.find({ userId }).lean(),
    QuizSession.find({ userId }).lean(),
  ]);
  const byDoc = new Map();
  for (const c of chunks) { const k = String(c.documentId); byDoc.set(k, [...(byDoc.get(k) ?? []), { chunkIndex: c.chunkIndex, pageStart: c.pageStart, pageEnd: c.pageEnd, text: c.text }]); }
  const strip = (doc) => { const copy = { ...doc }; delete copy.__v; delete copy.userId; return copy; };
  return {
    exportedAt: new Date().toISOString(),
    note: 'Everything PlacementPrep AI stores about you. Vector embeddings are not included.',
    profile: user.toJSON(),
    resumes: resumes.map(strip), jobAnalyses: analyses.map(strip),
    documents: documents.map((d) => ({ ...strip(d), chunks: byDoc.get(String(d._id)) ?? [] })),
    conversations: conversations.map(strip), interviews: interviews.map(strip), preparationPlan: plan ? strip(plan) : null,
    applications: applications.map(strip), quizzes: quizzes.map(strip),
  };
}

/**
 * Permanently deletes the account and EVERY record it owns. Requires the password (a stolen session alone cannot do this).
 * A background embedding job still running is harmless: it checks the document still exists before writing chunks.
 */
export async function deleteAccount(userId, password) {
  await verifyPassword(userId, password);
  const deleted = {};
  for (const Model of USER_OWNED_MODELS) deleted[Model.modelName] = (await Model.deleteMany({ userId })).deletedCount;
  await User.deleteOne({ _id: userId });
  await waitForIngestion(); // let any in-flight job notice the document is gone
  await DocumentChunk.deleteMany({ userId }); // belt and braces for a job that wrote between the two deletes
  return { deleted };
}
