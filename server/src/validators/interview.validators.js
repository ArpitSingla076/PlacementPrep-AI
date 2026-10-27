import { z } from 'zod';
import { env } from '../config/env.js';
import { CATEGORIES } from '../services/interview/interview.service.js';

export const createInterviewSchema = z.object({
  targetRole: z.string().trim().min(2, 'Enter a target role.').max(100),
  experienceLevel: z.enum(['intern', 'fresher', 'junior', 'mid']),
  category: z.enum(CATEGORIES),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  numQuestions: z.number().int().min(1).max(10),
  jobDescription: z.string().trim().max(env.MAX_INTERVIEW_JD_CHARS, `Keep the job description under ${env.MAX_INTERVIEW_JD_CHARS} characters.`).optional(),
  jobAnalysisId: z.string().min(1).optional(),
}).strict();

export const answerSchema = z.object({
  questionIndex: z.number().int().min(0).max(9),
  answer: z.string().trim().min(10, 'Write at least a sentence or two before submitting.').max(env.MAX_ANSWER_CHARS, `Keep the answer under ${env.MAX_ANSWER_CHARS} characters.`),
}).strict();
