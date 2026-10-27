import { Settings2 } from 'lucide-react';

const code = 'rounded bg-white/60 px-1';

/** Shown when the server owner has not finished configuring AI. Tells them exactly what to do. */
export function SetupNotice({ title, children }) {
  return (
    <div role="alert" className="rounded-panel border border-warn/30 bg-warn-bg p-5 text-sm text-warn">
      <p className="flex items-center gap-2 font-bold"><Settings2 className="size-4" aria-hidden="true" /> {title}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

export const Code = ({ children }) => <code className={code}>{children}</code>;
