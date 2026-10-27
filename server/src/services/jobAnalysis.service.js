import mongoose from 'mongoose';
import { Resume } from '../models/Resume.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { AppError } from '../utils/AppError.js';
import { paginate } from '../utils/pagination.js';
import { log } from '../utils/logger.js';
import { aiNotConfigured } from '../ai/errors.js';
import { generateStructured } from '../ai/structured.js';
import { redactContactInfo } from '../ai/redact.js';
import { resumeAnalysisSchema } from '../ai/schemas/resumeAnalysis.schema.js';
import { PROMPT_VERSION, SYSTEM_INSTRUCTION, buildUserPrompt } from '../ai/prompts/resumeAnalysis.v1.js';
import { RUBRIC_VERSION } from './analysis/rubric.js';
import { evaluateRequirements, prioritizeChecklist } from './analysis/scoring.js';
import { containsPhrase, normalizeForMatch } from './analysis/evidence.js';
import { sha256 } from './resume.service.js';

/** Collapse excessive whitespace so trivially different pastes of the same job description hash identically. */
export const normalizeJobDescription = (s) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// Identical requests that arrive at the same time share ONE provider call (double-clicks, retries, two tabs).
const inFlight = new Map();

/**
 * @param deps.llm    an LLM provider (see ai/providers/gemini.js)
 * @param deps.quota  per-user quota (ai/quota.js)
 * @param deps.config retry settings
 */
export async function createAnalysis({ userId, resumeId, jobDescription, forceRefresh = false }, { llm, quota, config }) {
  // A malformed id can never match a resume: answer exactly like "not yours" instead of letting Mongoose throw a CastError.
  const resume = mongoose.isValidObjectId(resumeId) ? await Resume.findOne({ _id: resumeId, userId }).select('+extractedText') : null;
  if (!resume) throw new AppError(404, 'NOT_FOUND', 'Resume not found.');

  const jd = normalizeJobDescription(jobDescription);
  const inputHash = sha256([resume.textHash, sha256(jd.replace(/\s+/g, ' ')), PROMPT_VERSION, RUBRIC_VERSION, llm.model ?? 'unconfigured'].join('|'));

  // 1. Cache: same resume + same job description + same prompt/rubric/model => reuse the saved result, zero cost.
  if (!forceRefresh) {
    const cached = await JobAnalysis.findOne({ userId, inputHash }).sort({ createdAt: -1 });
    if (cached) return { analysis: cached, cached: true };
  }

  // 2. Only now do we need the provider.
  if (!llm.isConfigured) throw aiNotConfigured();

  const key = `${userId}:${inputHash}:${forceRefresh}`;
  if (inFlight.has(key)) return { analysis: await inFlight.get(key), cached: true };

  const job = runAnalysis({ userId, resume, jd, inputHash }, { llm, quota, config }).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return { analysis: await job, cached: false };
}

async function runAnalysis({ userId, resume, jd, inputHash }, { llm, quota, config }) {
  // Data minimisation: contact details never leave the server.
  const { text: sentText, redactions } = redactContactInfo(resume.extractedText);

  quota.consume(userId);
  const started = Date.now();
  let result;
  try {
    result = await generateStructured({
      provider: llm,
      systemInstruction: SYSTEM_INSTRUCTION,
      userPrompt: buildUserPrompt({ resumeText: sentText, jobDescription: jd }),
      schema: resumeAnalysisSchema,
      temperature: 0.2,
      retries: config.retries,
      retryBaseMs: config.retryBaseMs,
      sleep: config.sleep,
      onRetry: ({ attempt, delay, code }) => log.warn(`[ai] retry ${attempt} in ${Math.round(delay)}ms (${code})`),
    });
  } catch (err) {
    quota.refund(userId); // our/provider's failure should not cost the user an analysis
    throw err;
  }

  const { data } = result;
  if (data.requirements.length === 0) {
    quota.refund(userId);
    throw new AppError(422, 'JD_NO_REQUIREMENTS',
      'We could not find any skills or requirements in that text. Paste the full job description, including the responsibilities and requirements sections.');
  }

  // 3. Code (not the model) verifies the evidence and computes the score.
  const { requirements, score } = evaluateRequirements(data.requirements, sentText);
  const resumeNorm = normalizeForMatch(sentText);

  const doc = await JobAnalysis.create({
    userId,
    resumeId: resume._id,
    resumeFilename: resume.originalFilename,
    roleTitle: data.roleTitle,
    jobDescription: jd,
    inputHash,
    requirements,
    score,
    // Claims about the resume are kept only if their quote really exists in it.
    relevantHighlights: data.relevantHighlights
      .map((h) => ({ ...h, quoteVerified: containsPhrase(resumeNorm, h.quote) }))
      .filter((h) => h.quoteVerified),
    resumeGaps: data.resumeGaps,
    suggestions: data.suggestions.map((s) => {
      if (s.type !== 'clarify_existing' || !s.currentText) return { ...s, currentTextVerified: false };
      const ok = containsPhrase(resumeNorm, s.currentText);
      return { ...s, currentText: ok ? s.currentText : '', currentTextVerified: ok };
    }),
    interviewTopics: data.interviewTopics,
    preparationChecklist: prioritizeChecklist(data.preparationChecklist, requirements),
    interviewQuestions: data.interviewQuestions,
    ai: {
      provider: llm.name, model: result.model, promptVersion: PROMPT_VERSION, repaired: result.repaired,
      promptTokens: result.usage.promptTokens, outputTokens: result.usage.outputTokens,
      latencyMs: Date.now() - started, redactions,
    },
  });
  return doc;
}

export const listAnalyses = (userId, paging) => paginate(JobAnalysis, { userId }, paging, { select: 'resumeId resumeFilename roleTitle score createdAt' });

export async function getAnalysis(userId, id) {
  const doc = await JobAnalysis.findOne({ _id: id, userId });
  if (!doc) throw new AppError(404, 'NOT_FOUND', 'Analysis not found.');
  return doc;
}

export async function deleteAnalysis(userId, id) {
  const { deletedCount } = await JobAnalysis.deleteOne({ _id: id, userId });
  if (!deletedCount) throw new AppError(404, 'NOT_FOUND', 'Analysis not found.');
}
