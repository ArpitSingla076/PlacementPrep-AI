import { z } from 'zod';

export const createQuizSchema = z.object({
  numQuestions: z.number().int().min(3).max(10),
  documentIds: z.array(z.string().min(1)).max(50).optional(),
}).strict();

export const submitQuizSchema = z.object({
  answers: z.array(z.number().int().min(0).max(3).nullable()).min(1).max(10), // null = skipped
}).strict();
