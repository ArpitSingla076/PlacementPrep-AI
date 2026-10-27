export const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const formatDateTime = (iso) => new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const humanize = (s) => String(s ?? '').replace(/_/g, ' ');
export const scoreTone = (n) => (n >= 70 ? 'ok' : n >= 40 ? 'warn' : 'bad');
