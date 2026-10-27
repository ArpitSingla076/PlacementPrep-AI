import mongoose from 'mongoose';
import { JobAnalysis } from '../../models/JobAnalysis.js';
import { AppError } from '../../utils/AppError.js';
import { normalizeSkillKey } from './evidence.js';

const side = (r) => (r ? { importance: r.importance, evidenceLevel: r.evidenceLevel, credit: r.credit, weight: r.weight } : null);

/**
 * Deterministic comparison of two saved analyses (no AI call). `a` is the baseline, `b` the one being compared to it.
 * Requirements are matched by normalised skill name. A skill present in only one report is reported as such, not guessed at.
 */
export function diffAnalyses(a, b) {
  const index = (doc) => new Map(doc.requirements.map((r) => [normalizeSkillKey(r.skill), r]));
  const ra = index(a); const rb = index(b);
  const rows = [...new Set([...ra.keys(), ...rb.keys()])].map((key) => {
    const x = ra.get(key); const y = rb.get(key);
    let change = 'same';
    if (!x) change = 'only_b'; else if (!y) change = 'only_a';
    else if (y.credit > x.credit) change = 'improved'; else if (y.credit < x.credit) change = 'declined';
    return { skill: (y ?? x).skill, a: side(x), b: side(y), change, weight: Math.max(x?.weight ?? 0, y?.weight ?? 0), delta: (y?.credit ?? 0) - (x?.credit ?? 0) };
  });
  const order = { improved: 0, declined: 1, only_b: 2, only_a: 3, same: 4 };
  rows.sort((p, q) => order[p.change] - order[q.change] || q.weight - p.weight || p.skill.localeCompare(q.skill));
  const count = (c) => rows.filter((r) => r.change === c).length;
  return {
    summary: { scoreA: a.score.overall, scoreB: b.score.overall, delta: b.score.overall - a.score.overall, improved: count('improved'), declined: count('declined'), same: count('same'), onlyA: count('only_a'), onlyB: count('only_b') },
    skills: rows,
  };
}

export async function compareAnalyses(userId, idA, idB) {
  if (idA === idB) throw new AppError(400, 'VALIDATION_ERROR', 'Choose two different analyses to compare.');
  const find = (id) => (mongoose.isValidObjectId(id) ? JobAnalysis.findOne({ _id: id, userId }) : null);
  const [a, b] = await Promise.all([find(idA), find(idB)]);
  if (!a || !b) throw new AppError(404, 'NOT_FOUND', 'Analysis not found.');
  const meta = (d) => ({ id: String(d._id), roleTitle: d.roleTitle, resumeFilename: d.resumeFilename, createdAt: d.createdAt, score: d.score.overall });
  return { a: meta(a), b: meta(b), ...diffAnalyses(a, b) };
}
