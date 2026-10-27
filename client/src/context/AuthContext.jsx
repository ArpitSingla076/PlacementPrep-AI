import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import * as authService from '../services/authService.js';

export const AuthContext = createContext(null);

/**
 * Holds "who is signed in". status: 'loading' (checking cookie) | 'authed' | 'anon'.
 * On first load we ask the server (GET /auth/me). We cannot read the httpOnly cookie ourselves -
 * that is the point of httpOnly - so the server is the only source of truth.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    authService
      .fetchCurrentUser()
      .then((u) => !cancelled && (setUser(u), setStatus('authed')))
      .catch(() => !cancelled && setStatus('anon'));
    return () => { cancelled = true; };
  }, []);

  // api.js fires this when any request reports an expired/invalid session.
  useEffect(() => {
    const onExpired = () => { setUser(null); setStatus('anon'); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const startSession = useCallback((u) => { setUser(u); setStatus('authed'); return u; }, []);
  const endSession = useCallback(() => { setUser(null); setStatus('anon'); }, []);

  const value = useMemo(() => ({
    user,
    status,
    updateUser: setUser,
    signIn: async (creds) => startSession(await authService.login(creds)),
    signUp: async (data) => startSession(await authService.register(data)),
    signOut: async () => { try { await authService.logout(); } finally { endSession(); } },
    signOutEverywhere: async () => { await authService.logoutEverywhere(); endSession(); },
  }), [user, status, startSession, endSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
