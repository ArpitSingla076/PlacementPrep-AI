/** Turns any axios/network error into text a user can act on. */
export function getErrorMessage(error) {
  if (error?.response?.data?.error?.message) return error.response.data.error.message;
  if (error?.code === 'ECONNABORTED') return 'The request took too long. Please try again.';
  if (error?.request && !error.response) return 'Cannot reach the server. Check your connection and try again.';
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
