/** Turns any axios/network error into text a user can act on. */
export function getErrorMessage(error) {
  if (error?.response?.data?.error?.message) return error.response.data.error.message;
  if (error?.code === 'ECONNABORTED') return 'The request took too long. Please try again.';
  // No reply at all: the server is asleep or restarting (free hosting), you are offline, or the browser blocked the call (CORS).
  if (error?.request && !error.response) return 'Cannot reach the server. If it was idle it may be waking up: wait a minute and try again. If this keeps happening, the site owner should check that the server is running and that its CLIENT_URL setting matches this website.';
  return 'Something went wrong. Please try again.';
}

/**
 * { fieldName: message } from the API's validation details, for showing errors next to inputs.
 * A field can fail several rules at once; we keep the FIRST message so users fix problems in the order the rules are listed.
 */
export function getFieldErrors(error) {
  const details = error?.response?.data?.error?.details;
  if (!Array.isArray(details)) return {};
  const errors = {};
  for (const d of details) if (!(d.field in errors)) errors[d.field] = d.message;
  return errors;
}
