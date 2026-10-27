import { useEffect, useRef } from 'react';
import { Button } from './Button.jsx';

/** Uses the native <dialog> element: focus trapping, Escape-to-close and the backdrop come from the browser. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', loading = false, onConfirm, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(28rem,92vw)] rounded-panel border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-navy-950/50"
    >
      <h2 id="confirm-title" className="text-lg font-bold">{title}</h2>
      <div className="mt-2 text-sm text-muted">{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
