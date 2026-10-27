/** A labelled 0..max bar. The number is always shown, so colour is never the only signal. */
export function ScoreBar({ label, value, max = 5 }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="font-medium capitalize">{label}</span><span className="font-bold">{value} / {max}</span></div>
      <div className="mt-1 h-2 rounded-full bg-navy-100" role="img" aria-label={`${label}: ${value} out of ${max}`}><div className="h-2 rounded-full bg-navy-800" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
