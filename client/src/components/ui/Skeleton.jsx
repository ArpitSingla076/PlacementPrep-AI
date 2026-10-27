// Placeholder block shown while data loads (keeps the layout from jumping).
export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-control bg-navy-100/70 ${className}`} />;
}
