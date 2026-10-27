/**
 * Data minimisation: remove contact details before text is sent to the external AI provider.
 * The model does not need an email address or phone number to judge skills, so it never receives them.
 * (Names, employers, schools and links are NOT removed: they can be part of the evidence. The consent text says so.)
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// optional country code, area code, then 1-2 more digit groups. Digit count is checked afterwards so that
// "2019 - 2023" or "2019-2023" are NOT mistaken for phone numbers.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3,5}\)?[\s.-]?\d{3,5}(?:[\s.-]?\d{3,5})?/g;

export function redactContactInfo(text) {
  let emails = 0;
  let phones = 0;
  let out = text.replace(EMAIL, () => { emails++; return '[EMAIL]'; });
  out = out.replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, '').length;
    if (digits < 10 || digits > 13) return match;
    phones++;
    return '[PHONE]';
  });
  return { text: out, redactions: { emails, phones } };
}
