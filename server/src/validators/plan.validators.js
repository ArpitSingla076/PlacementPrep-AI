import { z } from 'zod';

export const generatePlanSchema = z.object({ targetRole: z.string().trim().min(2).max(100).optional(), jobAnalysisId: z.string().min(1).optional() }).strict();
export const completeItemSchema = z.object({ completed: z.boolean() }).strict();
export const progressQuerySchema = z.object({
  days: z.enum(['30', '90', 'all']).default('all').transform((v) => (v === 'all' ? null : Number(v))),
  category: z.string().trim().max(80).optional(),
});
