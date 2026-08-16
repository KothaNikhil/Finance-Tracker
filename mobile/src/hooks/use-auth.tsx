/**
 * Auth context: exposes the current Supabase session (or null), a loading flag while the initial
 * session is read, and whether Supabase is configured at all. When it isn't configured, the app
 * runs without a login gate so it stays usable during setup.
 */

import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { getCurrentSession, onAuthChange } from '@/services/auth/auth';
import { isSupabaseConfigured } from '@/services/auth/config';

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** True once real Supabase credentials are in; false means no login gate. */
  configured: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, configured: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let active = true;
    getCurrentSession().then((s) => {
      if (active) {
        setSession(s);
        setLoading(false);
      }
    });
    const unsubscribe = onAuthChange((s) => {
      if (active) setSession(s);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [configured]);

  return <AuthContext.Provider value={{ session, loading, configured }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
