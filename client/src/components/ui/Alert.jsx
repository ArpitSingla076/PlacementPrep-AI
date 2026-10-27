import { AlertCircle } from 'lucide-react';

export function Alert({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-control border border-bad/25 bg-bad-bg px-3.5 py-3 text-sm text-bad">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
