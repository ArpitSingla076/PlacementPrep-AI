export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      {Icon && <Icon className="size-5 text-muted" aria-hidden="true" />}
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-prose text-sm text-muted">{children}</p>
    </div>
  );
}
