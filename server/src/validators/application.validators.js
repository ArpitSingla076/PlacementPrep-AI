import { z } from 'zod';
import { APPLICATION_STATUSES } from '../models/JobApplication.js';

// Only http(s) links: a "javascript:" URL rendered as a link would be an XSS vector.
const url = z.string().trim().max(500).refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), 'Enter a full http(s) link, e.g. https://company.com/jobs/123');
const text = (n) => z.string().trim().max(n);
const date = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date.').transform((v) => new Date(v));

export const createApplicationSchema = z.object({
  company: text(100).min(1, 'Enter the company name.'),
  roleTitle: text(100).min(1, 'Enter the role.'),
  status: z.enum(APPLICATION_STATUSES).optional(),
  jobUrl: url.optional(), location: text(100).optional(), notes: text(2000).optional(), deadline: date.optional(),
  jobAnalysisId: z.string().min(1).optional(),
}).strict();

// On update, null clears an optional field.
export const updateApplicationSchema = z.object({
  company: text(100).min(1), roleTitle: text(100).min(1), status: z.enum(APPLICATION_STATUSES),
  jobUrl: url.nullable(), location: text(100).nullable(), notes: text(2000).nullable(), deadline: date.nullable(), appliedAt: date.nullable(),
  jobAnalysisId: z.string().min(1).nullable(),
}).partial().strict().refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.');

export const compareQuerySchema = z.object({ a: z.string().min(1), b: z.string().min(1) });
