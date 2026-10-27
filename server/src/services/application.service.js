import mongoose from 'mongoose';
import { JobApplication } from '../models/JobApplication.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

async function assertOwnAnalysis(userId, id) {
  if (!id) return;
  if (!mongoose.isValidObjectId(id) || !(await JobAnalysis.exists({ _id: id, userId }))) throw new AppError(404, 'NOT_FOUND', 'Resume analysis not found.');
}

/** Attach a small summary of the linked analysis (one query for the whole list, not one per card). */
async function toClient(userId, docs) {
  const ids = docs.map((d) => d.jobAnalysisId).filter(Boolean);
  const analyses = ids.length ? await JobAnalysis.find({ _id: { $in: ids }, userId }).select('roleTitle score.overall') : [];
  const byId = new Map(analyses.map((a) => [String(a._id), { id: String(a._id), roleTitle: a.roleTitle, score: a.score?.overall ?? 0 }]));
  return docs.map((d) => {
    const o = d.toObject();
    return { ...o, id: String(o._id), _id: undefined, __v: undefined, userId: undefined, jobAnalysisId: undefined, analysis: byId.get(String(d.jobAnalysisId)) ?? null };
  });
}

export async function listApplications(userId) {
  return toClient(userId, await JobApplication.find({ userId }).sort({ updatedAt: -1 }).limit(env.MAX_APPLICATIONS_PER_USER));
}

export async function createApplication(userId, input) {
  if ((await JobApplication.countDocuments({ userId })) >= env.MAX_APPLICATIONS_PER_USER) {
    throw new AppError(409, 'APPLICATION_LIMIT_REACHED', `You can track up to ${env.MAX_APPLICATIONS_PER_USER} applications. Delete some to add more.`);
  }
  await assertOwnAnalysis(userId, input.jobAnalysisId);
  const status = input.status ?? 'saved';
  const doc = await JobApplication.create({ ...input, userId, status, statusHistory: [{ status, at: new Date() }], ...(status === 'applied' && { appliedAt: new Date() }) });
  return (await toClient(userId, [doc]))[0];
}

export async function updateApplication(userId, id, changes) {
  const doc = mongoose.isValidObjectId(id) ? await JobApplication.findOne({ _id: id, userId }) : null;
  if (!doc) throw new AppError(404, 'NOT_FOUND', 'Application not found.');
  if (changes.jobAnalysisId) await assertOwnAnalysis(userId, changes.jobAnalysisId);

  // Explicit allow-list: nothing else on the document can be changed from the request.
  for (const key of ['company', 'roleTitle', 'jobUrl', 'location', 'notes', 'deadline', 'appliedAt', 'jobAnalysisId']) {
    if (changes[key] === undefined) continue;
    doc[key] = changes[key] === null ? undefined : changes[key];
  }
  if (changes.status && changes.status !== doc.status) {
    doc.status = changes.status;
    doc.statusHistory.push({ status: changes.status, at: new Date() });
    if (changes.status === 'applied' && !doc.appliedAt) doc.appliedAt = new Date();
  }
  await doc.save();
  return (await toClient(userId, [doc]))[0];
}

export async function deleteApplication(userId, id) {
  const { deletedCount } = mongoose.isValidObjectId(id) ? await JobApplication.deleteOne({ _id: id, userId }) : { deletedCount: 0 };
  if (!deletedCount) throw new AppError(404, 'NOT_FOUND', 'Application not found.');
}
