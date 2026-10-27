import { z } from 'zod';

const role = z.string().trim().min(1).max(80);

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    targetRoles: z
      .array(role)
      .max(5, 'You can add up to 5 target roles.')
      .transform((roles) => [...new Set(roles)]), // de-duplicate
    aiDataConsent: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.');

import { password } from './auth.validators.js';

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, 'Enter your current password.').max(72), newPassword: password }).strict();
export const deleteAccountSchema = z.object({ password: z.string().min(1, 'Enter your password to confirm.').max(72) }).strict();
