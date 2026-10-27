import { z } from 'zod';

/**
 * What we ask the model to return. NOTE what is absent: there is no "score" field.
 * The model classifies evidence; code computes the score. `.strict()` rejects any extra key,
 * so a model (or an injected instruction) cannot smuggle in its own number.
 */
const text = (max) => z.string().trim().max(max);

export const CATEGORIES = ['language', 'framework', 'database', 'tool', 'cs_fundamental', 'concept', 'soft_skill', 'education', 'experience', 'other'];

const requirement = z.object({
  skill: text(80).min(1).describe('Short name of the requirement, e.g. "Node.js", "REST APIs", "SQL joins".'),
  category: z.enum(CATEGORIES),
  importance: z.enum(['required', 'preferred', 'bonus']).describe('From the job description wording only.'),
  evidenceLevel: z.enum(['demonstrated', 'listed', 'inferred', 'none']),
  matchedTerm: text(60).describe('The exact word(s) in the resume that name this skill. Empty string if evidenceLevel is inferred or none.'),
  evidenceQuote: text(300).describe('A verbatim, contiguous excerpt copied from the resume that supports the level. Empty string if none.'),
  note: text(240).describe('One short sentence explaining the classification.'),
}).strict();

export const resumeAnalysisSchema = z.object({
  roleTitle: text(100).describe('Job title from the job description, or an empty string if not stated.'),
  requirements: z.array(requirement).max(30),
  relevantHighlights: z.array(z.object({
    item: text(150).describe('A project or experience from the resume that is relevant to this job.'),
    whyRelevant: text(240),
    quote: text(300).describe('Verbatim excerpt from the resume.'),
  }).strict()).max(6),
  resumeGaps: z.array(text(200)).max(6).describe('Information that is missing or unclear in the resume itself.'),
  suggestions: z.array(z.object({
    section: text(80).describe('Where in the resume, e.g. "Project: Chat App".'),
    type: z.enum(['clarify_existing', 'conditional_add']),
    currentText: text(300).describe('The existing resume text this refers to (verbatim), or an empty string for conditional_add.'),
    suggestion: text(400),
    reason: text(240),
  }).strict()).max(8),
  interviewTopics: z.array(z.object({ topic: text(80), reason: text(200) }).strict()).max(8),
  preparationChecklist: z.array(z.object({
    task: text(200),
    relatedSkill: text(80).describe('Must equal the "skill" of one requirement above.'),
  }).strict()).max(10),
  interviewQuestions: z.array(z.object({
    question: text(300),
    topic: text(80),
    difficulty: z.enum(['easy', 'medium', 'hard']),
  }).strict()).max(10),
}).strict();
