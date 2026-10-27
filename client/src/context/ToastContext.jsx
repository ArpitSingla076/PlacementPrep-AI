import { createContext, useCallback, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((tone, message) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live so screen readers announce toasts without moving focus */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex max-w-md items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm shadow-lg"
          >
            {t.tone === 'success'
              ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
              : <AlertCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden="true" />}
            <p className="flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded p-0.5 text-muted hover:text-ink">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
