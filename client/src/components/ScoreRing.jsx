/** Circular gauge. The number is always printed inside, so the colour is never the only signal. */
export function ScoreRing({ value, size = 128 }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 70 ? 'var(--color-ok)' : value >= 40 ? 'var(--color-warn)' : 'var(--color-bad)';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Estimated match: ${value} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-navy-100)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-extrabold leading-none">{value}</span>
        <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">of 100</span>
      </div>
    </div>
  );
}
