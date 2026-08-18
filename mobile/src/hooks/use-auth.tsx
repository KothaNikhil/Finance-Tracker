/**
 * Auth context: exposes the current Supabase session (or null), a loading flag while the initial
 * session is read, and whether Supabase is configured at all. When it isn't configured, the app
 * runs without a login gate so it stays usable during setup.
 */

import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { completeSignInFromUrl, getCurrentSession, onAuthChange } from '@/services/auth/auth';
import { DEV_BYPASS_LOGIN, isSupabaseConfigured } from '@/services/auth/config';
import { setActiveDbAccount } from '@/services/db/database';

/** Bind the local database to a session's account BEFORE re-rendering, so screens read the right file. */
function bindDbToSession(session: Session | null): void {
  setActiveDbAccount(session?.user?.id ?? null);
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** True once real Supabase credentials are in; false means no login gate. */
  configured: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, configured: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  // DEV_BYPASS_LOGIN drops the gate entirely (emulator has no Google sign-in). Never true in release.
  const configured = isSupabaseConfigured() && !DEV_BYPASS_LOGIN;
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
        bindDbToSession(s);
        setSession(s);
        setLoading(false);
      }
    });
    const unsubscribe = onAuthChange((s) => {
      if (active) {
        bindDbToSession(s);
        setSession(s);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [configured]);

  // Handle the Google OAuth redirect return (WEB: the browser comes back with a PKCE `?code=`;
  // native uses the ID-token flow and won't hit this). On success, onAuthChange above picks up the
  // new session and the gate opens.
  useEffect(() => {
    if (!configured) return;
    const handle = (url: string | null) => {
      if (url) completeSignInFromUrl(url).catch(() => {});
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [configured]);

  return <AuthContext.Provider value={{ session, loading, configured }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
