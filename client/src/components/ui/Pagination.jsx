import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const btn = 'inline-flex size-9 items-center justify-center rounded-control border border-line bg-surface hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted">Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" aria-hidden="true" /></button>
        <button type="button" className={btn} disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight className="size-4" aria-hidden="true" /></button>
      </div>
    </nav>
  );
}
