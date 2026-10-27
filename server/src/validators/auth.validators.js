import { z } from 'zod';

// bcrypt only uses the first 72 BYTES of a password; longer input would be silently truncated.
// We cap length so what the user typed is what actually gets hashed.
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.')
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Password must contain a letter and a number.');

const email = z.email('Enter a valid email address.').max(254).transform((v) => v.trim().toLowerCase());

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80),
    email,
    password,
  })
  .strict(); // reject unknown fields => no mass-assignment surprises

// Login does NOT apply password-strength rules: we only check the credentials match.
export const loginSchema = z
  .object({ email, password: z.string().min(1, 'Password is required.').max(72) })
  .strict();
