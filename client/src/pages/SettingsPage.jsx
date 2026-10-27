import { useState } from 'react';
import { X, Download, KeyRound, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import { updateProfile } from '../services/userService.js';
import { changePassword, downloadMyData, deleteAccount } from '../services/accountService.js';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { getErrorMessage, getFieldErrors } from '../utils/errors.js';

const MAX_ROLES = 5;

function Section({ title, description, children }) {
  return (
    <section className="grid grid-cols-1 gap-6 border-t border-line py-8 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="font-bold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}

function AccountSections() {
  const { signOut } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwFields, setPwFields] = useState({});
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [delPassword, setDelPassword] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState('');

  const savePassword = async (e) => {
    e.preventDefault(); setPwBusy(true); setPwError(''); setPwFields({});
    try { await changePassword(pw); setPw({ currentPassword: '', newPassword: '' }); toast.success('Password changed. Your other devices were signed out.'); }
    catch (err) { setPwFields(getFieldErrors(err)); setPwError(Object.keys(getFieldErrors(err)).length ? '' : getErrorMessage(err)); }
    finally { setPwBusy(false); }
  };
  const exportData = async () => {
    setExporting(true);
    try { await downloadMyData(); toast.success('Your data was downloaded.'); } catch (err) { toast.error(getErrorMessage(err)); } finally { setExporting(false); }
  };
  const removeAccount = async () => {
    setDelBusy(true); setDelError('');
    try { await deleteAccount(delPassword); await signOut(); } catch (err) { setDelError(getErrorMessage(err)); setDelBusy(false); }
  };

  return (
    <>
      <Section title="Change password" description="Other devices are signed out when you change it.">
        <form onSubmit={savePassword} noValidate className="max-w-md space-y-4">
          <Alert>{pwError}</Alert>
          <Field label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} error={pwFields.currentPassword} />
          <Field label="New password" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={pwFields.newPassword} hint="At least 8 characters, with a letter and a number." />
          <Button type="submit" variant="secondary" loading={pwBusy} disabled={!pw.currentPassword || !pw.newPassword}><KeyRound className="size-4" aria-hidden="true" />Change password</Button>
        </form>
      </Section>

      <Section title="Your data" description="You own everything you add here.">
        <p className="max-w-xl text-sm text-muted">Download a JSON file with your profile, resumes, analyses, notes (as text), conversations, interviews, quizzes, plan and applications. Vector embeddings are not included.</p>
        <Button variant="secondary" className="mt-4" onClick={exportData} loading={exporting}><Download className="size-4" aria-hidden="true" />Download my data</Button>
      </Section>

      <Section title="Delete account" description="This cannot be undone.">
        <p className="max-w-xl text-sm text-muted">Permanently deletes your account and <strong className="text-ink">everything</strong> stored about you: resumes, analyses, documents and their search data, conversations, interviews, quizzes, plan and applications.</p>
        <Button variant="danger" className="mt-4" onClick={() => { setDelPassword(''); setDelError(''); setConfirmOpen(true); }}><Trash2 className="size-4" aria-hidden="true" />Delete my account</Button>
      </Section>

      <ConfirmDialog open={confirmOpen} title="Delete your account?" confirmLabel="Delete everything" loading={delBusy} onConfirm={removeAccount} onCancel={() => setConfirmOpen(false)}>
        <p>This permanently deletes your account and all your data. Enter your password to confirm.</p>
        <div className="mt-3"><Field label="Password" type="password" autoComplete="current-password" value={delPassword} onChange={(e) => setDelPassword(e.target.value)} /></div>
        <div className="mt-2"><Alert>{delError}</Alert></div>
      </ConfirmDialog>
    </>
  );
}

export default function SettingsPage() {
  const { user, updateUser, signOutEverywhere } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user.name);
  const [roles, setRoles] = useState(user.targetRoles);
  const [roleDraft, setRoleDraft] = useState('');
  const [consent, setConsent] = useState(user.preferences?.aiDataConsent?.given === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const addRole = () => {
    const value = roleDraft.trim();
    if (!value || roles.includes(value) || roles.length >= MAX_ROLES) return;
    setRoles([...roles, value]);
    setRoleDraft('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      updateUser(await updateProfile({ name, targetRoles: roles, aiDataConsent: consent }));
      toast.success('Settings saved.');
    } catch (err) {
      setFieldErrors(getFieldErrors(err));
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    try { await signOutEverywhere(); } catch (err) { toast.error(getErrorMessage(err)); }
  };

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Profile and settings</h1>

      <form onSubmit={handleSave} noValidate className="mt-8">
        <Alert>{error}</Alert>

        <Section title="Profile">
          <div className="max-w-md space-y-4">
            <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} autoComplete="name" />
            <Field label="Email" value={user.email} disabled hint="Email cannot be changed yet." />
          </div>
        </Section>

        <Section title="Target roles" description={`Up to ${MAX_ROLES}. Used to personalise interviews and plans.`}>
          <div className="max-w-md">
            <div className="flex items-end gap-2">
              <Field
                label="Add a role"
                className="flex-1"
                value={roleDraft}
                placeholder="e.g. Backend Developer"
                maxLength={80}
                onChange={(e) => setRoleDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } }}
                disabled={roles.length >= MAX_ROLES}
              />
              <Button variant="secondary" onClick={addRole} disabled={!roleDraft.trim() || roles.length >= MAX_ROLES}>Add</Button>
            </div>
            {roles.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Your target roles">
                {roles.map((r) => (
                  <li key={r} className="flex items-center gap-1 rounded-full bg-navy-50 py-1 pl-3 pr-1 text-sm font-medium text-navy-800">
                    {r}
                    <button type="button" onClick={() => setRoles(roles.filter((x) => x !== r))} aria-label={`Remove ${r}`} className="rounded-full p-1 hover:bg-navy-100">
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title="AI and your data" description="You are in control of what leaves this app.">
          <label className="flex max-w-xl items-start gap-3">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 accent-navy-900" />
            <span className="text-sm">
              <span className="font-semibold">Allow AI processing of my content</span>
              <span className="mt-1 block text-muted">
                When AI features are available, the text of your resume, job descriptions, relevant passages from your
                study notes, and your interview answers will be sent to the AI provider configured for this app so it can
                write analyses, answers and feedback. Nothing is sent while this is off. You can turn it off at any time.
              </span>
            </span>
          </label>
        </Section>

        <div className="border-t border-line pt-6">
          <Button type="submit" loading={saving}>Save changes</Button>
        </div>
      </form>

      <Section title="Sessions" description="Sign out of every browser and device.">
        <Button variant="danger" onClick={handleSignOutEverywhere}>Sign out everywhere</Button>
      </Section>

      <AccountSections />
    </div>
  );
}
