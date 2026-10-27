import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';

function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-navy-700" aria-hidden="true" />
      <span className="sr-only">Loading your session</span>
    </div>
  );
}

/**
 * Frontend route guards are for USER EXPERIENCE only - they stop a signed-out user seeing an empty shell.
 * Real security is enforced by the API (requireAuth on every protected endpoint).
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function PublicOnly() {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authed') return <Navigate to="/" replace />;
  return <Outlet />;
}
