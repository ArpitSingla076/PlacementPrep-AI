import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

/**
 * Compared against when the email does not exist, so a "no such user" login takes about as long as
 * a "wrong password" login. Without it, response timing would reveal which emails are registered.
 */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', env.BCRYPT_ROUNDS);

export async function registerUser({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  try {
    return await User.create({ name, email, passwordHash });
  } catch (err) {
    // 11000 = duplicate key. We rely on the unique index (not a "check then insert"),
    // so two simultaneous registrations cannot both succeed.
    if (err?.code === 11000) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw err;
  }
}

export async function authenticate({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
  const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matches) {
    // Same message for both cases on purpose.
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  return user;
}

/**
 * Session design (documented trade-offs are in the README):
 *  - The JWT lives in an httpOnly cookie => JavaScript (and therefore XSS) cannot read it.
 *  - Cookies are sent automatically by the browser, which is what makes CSRF possible.
 *    So the JWT also carries a random `csrf` value. State-changing requests must echo it in an
 *    X-CSRF-Token header. A malicious site can make the browser SEND the cookie, but cannot READ
 *    the csrf value (CORS only allows our own frontend origin), so it cannot forge the header.
 *  - `tv` (token version) lets us invalidate all sessions for a user server-side.
 */
export function issueSession(user) {
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const token = jwt.sign(
    { sub: user._id.toString(), csrf: csrfToken, tv: user.tokenVersion ?? 0 },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${env.SESSION_DAYS}d` },
  );
  return { token, csrfToken };
}

export function verifySessionToken(token) {
  // Pin the algorithm: never let the token choose how it is verified (blocks "alg: none" tricks).
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
}

export async function invalidateAllSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}
