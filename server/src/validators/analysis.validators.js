import { z } from 'zod';
import { env } from '../config/env.js';

export const createAnalysisSchema = z
  .object({
    resumeId: z.string().min(1, 'Choose a resume.'),
    jobDescription: z
      .string()
      .trim()
      .min(env.MIN_JD_CHARS, `Paste the full job description (at least ${env.MIN_JD_CHARS} characters).`)
      .max(env.MAX_JD_CHARS, `The job description is too long (limit ${env.MAX_JD_CHARS.toLocaleString()} characters).`),
    forceRefresh: z.boolean().optional(),
  })
  .strict();
