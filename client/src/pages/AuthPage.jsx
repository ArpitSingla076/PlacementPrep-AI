import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { Button } from '../components/ui/Button.jsx';
import { Field } from '../components/ui/Field.jsx';
import { Alert } from '../components/ui/Alert.jsx';
import { getErrorMessage, getFieldErrors } from '../utils/errors.js';

const COPY = {
  login: {
    title: 'Sign in',
    lead: 'Pick up where you left off.',
    submit: 'Sign in',
    alt: { text: 'New here?', link: 'Create an account', to: '/register' },
  },
  register: {
    title: 'Create your account',
    lead: 'Your resumes, notes and practice history stay private to you.',
    submit: 'Create account',
    alt: { text: 'Already registered?', link: 'Sign in', to: '/login' },
  },
};

export default function AuthPage({ mode }) {
  const copy = COPY[mode];
  const isRegister = mode === 'register';
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');
    setFieldErrors({});
    try {
      if (isRegister) await signUp(form);
      else await signIn({ email: form.email, password: form.password });
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      const fields = getFieldErrors(err);
      setFieldErrors(fields);
      // Show the general message only when no field-level message explains the problem.
      setFormError(Object.keys(fields).length ? '' : getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <section className="hidden flex-col justify-between bg-navy-900 p-12 text-white lg:flex">
        <span className="flex items-center gap-2.5 text-lg font-extrabold">
          <GraduationCap className="size-6" aria-hidden="true" /> PlacementPrep AI
        </span>
        <div className="max-w-md">
          <h2 className="text-4xl font-extrabold leading-tight">Prepare for placements with evidence, not guesses.</h2>
          <ul className="mt-8 space-y-4 text-[15px] text-navy-100/85">
            <li>Compare your resume against a real job description and see which skills need more proof.</li>
            <li>Ask technical questions and get answers drawn from your own notes, with sources you can check.</li>
            <li>Practise interviews and find out which topics keep costing you marks.</li>
          </ul>
        </div>
        <p className="text-xs text-navy-100/55">AI-generated scores are estimates. Always review them yourself.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-3xl font-extrabold">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted">{copy.lead}</p>

          <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-4">
            <Alert>{formError}</Alert>
            {isRegister && (
              <Field label="Full name" value={form.name} onChange={set('name')} error={fieldErrors.name} autoComplete="name" required />
            )}
            <Field label="Email" type="email" value={form.email} onChange={set('email')} error={fieldErrors.email} autoComplete="email" required />
            <Field
              label="Password"
              type="password"
              value={form.password}
              onChange={set('password')}
              error={fieldErrors.password}
              hint={isRegister ? 'At least 8 characters, with a letter and a number.' : undefined}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
            />
            <Button type="submit" loading={loading} className="w-full">{copy.submit}</Button>
          </form>

          <p className="mt-6 text-sm text-muted">
            {copy.alt.text}{' '}
            <Link to={copy.alt.to} className="font-semibold text-navy-800 underline underline-offset-4">{copy.alt.link}</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
