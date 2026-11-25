/**
 * A free-tier server that has been idle takes up to about a minute to wake up. While it does, the browser can see no reply at all,
 * or an error page from the hosting platform (404, 502, 503, 504) instead of our app. Those are "server not ready yet", not real answers.
 * A genuine answer from the app (401 not signed in, 400 invalid input, 200 ...) is final and is never retried.
 */
export const NOT_READY_STATUSES = new Set([404, 408, 502, 503, 504]);

export function serverNotReady(err) {
  return !err?.response || NOT_READY_STATUSES.has(err.response.status);
}

export async function retryWhileWaking(fn, { attempts = 8, delayMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onWait } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!serverNotReady(err) || attempt >= attempts) throw err;
      onWait?.(attempt);
      await sleep(delayMs);
    }
  }
}
