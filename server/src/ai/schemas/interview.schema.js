import { z } from 'zod';

const text = (n) => z.string().trim().max(n);

export const interviewGenerationSchema = z.object({
  questions: z.array(z.object({
    question: text(400).min(10),
    topic: text(60).min(2).describe('A short topic label such as "SQL joins" or "Java collections".'),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    keyPoints: z.array(text(160).min(3)).min(2).max(6).describe('The ideas a good answer must contain (the rubric).'),
  }).strict()).min(1).max(10),
}).strict();

/**
 * The model judges; it does not compute totals. `coveredPoints` is aligned with the rubric's keyPoints so code can derive
 * completeness itself, and the 0-5 scores are integers that code validates and combines.
 */
export const interviewEvaluationSchema = z.object({
  coveredPoints: z.array(z.boolean()).max(8).describe('One true/false per rubric key point, in order: did the answer clearly state it?'),
  correctness: z.number().int().min(0).max(5).describe('Are the statements the candidate made technically correct? Wrong statements lower this even if long.'),
  relevance: z.number().int().min(0).max(5).describe('Does the answer address the question that was asked?'),
  clarity: z.number().int().min(0).max(5).describe('Is it clearly and logically explained? Length does not matter.'),
  whatWasCorrect: z.array(text(200)).max(5),
  missingOrIncorrect: z.array(text(200)).max(6),
  strongerAnswer: text(900).describe('A concise model answer covering the key points.'),
  followUp: text(300).describe('One relevant follow-up question, or an empty string.'),
}).strict();
