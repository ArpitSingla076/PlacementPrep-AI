import { Loader2 } from 'lucide-react';

const variants = {
  primary: 'bg-navy-900 text-white hover:bg-navy-800 disabled:bg-navy-900/50',
  secondary: 'border border-line bg-surface text-ink hover:bg-navy-50 disabled:text-muted',
  ghost: 'text-muted hover:bg-navy-50 hover:text-ink',
  danger: 'border border-bad/30 bg-surface text-bad hover:bg-bad-bg',
};

export function Button({ variant = 'primary', loading = false, disabled, className = '', children, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
