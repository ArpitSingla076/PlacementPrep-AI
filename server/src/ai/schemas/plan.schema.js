import { z } from 'zod';

const text = (n) => z.string().trim().max(n);

/** Built per request so the model can only fill in the items the server decided on. */
export function planWritingSchema(keys) {
  const allowed = new Set(keys);
  return z.object({
    items: z.array(z.object({
      key: text(120),
      action: text(400).min(5).describe('One or two sentences: what to study or do, and why it helps.'),
      practice: z.array(z.object({ type: z.enum(['question', 'task']), text: text(300).min(5) }).strict()).min(1).max(3),
    }).strict()).max(20),
  }).strict().superRefine((v, ctx) => {
    const seen = new Set(v.items.map((i) => i.key));
    for (const i of v.items) if (!allowed.has(i.key)) ctx.addIssue({ code: 'custom', message: `unknown key "${i.key}": use only the provided keys` });
    for (const k of allowed) if (!seen.has(k)) ctx.addIssue({ code: 'custom', message: `missing item for key "${k}"` });
  });
}
