import { useId } from 'react';

/** Label + input + hint + error, wired together for screen readers (aria-describedby / aria-invalid). */
export function Field({ label, error, hint, className = '', ...inputProps }) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block min-h-11 w-full rounded-control border bg-surface px-3 text-sm placeholder:text-muted/70 ${error ? 'border-bad' : 'border-line'} disabled:bg-canvas disabled:text-muted`}
        {...inputProps}
      />
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-bad">{error}</p>}
    </div>
  );
}
