import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, X, GraduationCap } from 'lucide-react';
import { NAV_ITEMS } from '../utils/navigation.js';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';

function Nav({ onNavigate }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ path, label, icon: Icon, milestone }) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex min-h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors ${
              isActive ? 'bg-white/12 text-white' : 'text-navy-100/80 hover:bg-white/8 hover:text-white'
            }`}
        >
          <Icon className="size-[18px] shrink-0" aria-hidden="true" />
          <span className="flex-1">{label}</span>
          {milestone && <span className="text-[11px] text-navy-100/55">Soon</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function SidebarContent({ onNavigate }) {
  const { user, signOut } = useAuth();
  const toast = useToast();

  const handleSignOut = async () => {
    try { await signOut(); } catch { toast.error('Could not sign out cleanly, but this device has been signed out.'); }
  };

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2.5 px-2 pt-1 text-white">
        <GraduationCap className="size-6" aria-hidden="true" />
        <span className="text-base font-extrabold tracking-tight">PlacementPrep AI</span>
      </div>
      <Nav onNavigate={onNavigate} />
      <div className="mt-auto border-t border-white/12 pt-4">
        <p className="truncate px-2 text-sm font-semibold text-white">{user?.name}</p>
        <p className="truncate px-2 pb-2 text-xs text-navy-100/65">{user?.email}</p>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-sm font-medium text-navy-100/80 transition-colors hover:bg-white/8 hover:text-white"
        >
          <LogOut className="size-[18px]" aria-hidden="true" /> Sign out
        </button>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const { pathname } = useLocation();
  // Remember WHICH page the drawer was opened on. Navigating changes pathname, so the drawer
  // closes by itself: derived state, no effect needed.
  const [openedAt, setOpenedAt] = useState(null);
  const drawerOpen = openedAt === pathname;
  const setDrawerOpen = (open) => setOpenedAt(open ? pathname : null);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpenedAt(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden bg-navy-900 lg:sticky lg:top-0 lg:block lg:h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-900 px-4 py-2.5 text-white lg:hidden">
        <span className="flex items-center gap-2 text-sm font-extrabold">
          <GraduationCap className="size-5" aria-hidden="true" /> PlacementPrep AI
        </span>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          className="rounded-control p-2 hover:bg-white/10"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-navy-900">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-2 top-2 rounded-control p-2 text-white hover:bg-white/10"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <main id="main" className="min-w-0 px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
        <div className="mx-auto max-w-5xl"><Outlet /></div>
      </main>
    </div>
  );
}
