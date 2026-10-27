import { AppError } from '../utils/AppError.js';

/**
 * Per-user sliding-window quota for calls that actually hit the paid/limited provider.
 * It is consumed only when we are about to call the model - cached results and validation failures are free.
 * In-memory: correct for a single server instance (documented limitation).
 */
export class UserQuota {
  constructor({ limit, windowMs = 60 * 60 * 1000, now = () => Date.now() }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map(); // userId -> number[] timestamps
  }

  #fresh(userId) {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(String(userId)) ?? []).filter((t) => t > cutoff);
    this.hits.set(String(userId), list);
    return list;
  }

  remaining(userId) {
    return Math.max(0, this.limit - this.#fresh(userId).length);
  }

  consume(userId) {
    const list = this.#fresh(userId);
    if (list.length >= this.limit) {
      const retryAfterMin = Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 60_000));
      throw new AppError(429, 'AI_QUOTA_EXCEEDED',
        `You have used all ${this.limit} AI analyses allowed per hour. Try again in about ${retryAfterMin} minute${retryAfterMin === 1 ? '' : 's'}.`);
    }
    list.push(this.now());
  }

  /** Give the slot back when the call failed before producing a result (we don't charge users for our failures). */
  refund(userId) {
    this.#fresh(userId).pop();
  }
}
