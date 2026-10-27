import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { updateProfile } from '../services/userService.js';
import { Button } from './ui/Button.jsx';
import { getErrorMessage } from '../utils/errors.js';

const RESUME_COPY = (
  <>
    To analyse your resume, this app sends its <strong className="text-ink">text</strong> and the job description you paste to the AI provider
    (Google Gemini) so it can read them. Email addresses and phone numbers are removed first. Your name, schools, employers and links are not.
    Your original PDF file is never sent or stored.
  </>
);

/** Shown until the user allows AI processing. The server independently refuses AI calls without consent. */
export function ConsentCard({ title = 'Before you analyse a resume', children = RESUME_COPY, onGranted }) {
  const { updateUser } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const allow = async () => {
    setSaving(true);
    try {
      updateUser(await updateProfile({ aiDataConsent: true }));
      toast.success('AI processing enabled. You can turn it off any time in Settings.');
      onGranted?.();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="consent-title" className="rounded-panel border border-navy-100 bg-navy-50 p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-navy-700" aria-hidden="true" />
        <div className="text-sm">
          <h2 id="consent-title" className="text-base font-bold">{title}</h2>
          <p className="mt-2 text-muted">{children}</p>
          <p className="mt-2 text-muted">
            Check the provider&apos;s terms for how submitted content is kept or used on the plan behind this server&apos;s API key. Free plans may differ from paid ones.
            Nothing is sent unless you allow it, and you can turn this off any time in Settings.
          </p>
          <Button className="mt-4" onClick={allow} loading={saving}>Allow AI processing</Button>
        </div>
      </div>
    </section>
  );
}
