/**
 * Auth actions (Step 1 login) on top of Supabase. Login is Google-only: native uses the Google
 * account picker + ID token; web uses a Supabase OAuth browser redirect. The session itself lives
 * in the Supabase client (persisted in AsyncStorage); these are just the verbs the UI calls.
 */

import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { signInWithGoogleAccount, signOutGoogleAccount } from './google-account';
import { getSupabase } from './supabase';

// Google-account sign-in/out is platform-split (native picker+ID token vs web OAuth redirect).
// Re-exported here so callers keep importing from `@/services/auth/auth`.
export { signInWithGoogleAccount };

/**
 * Finish a Google OAuth sign-in from the redirect URL the app was opened with (WEB: the browser
 * returns to this origin with a PKCE `?code=`; native uses the ID-token flow and never hits this).
 * Exchanges the `?code=...` for a session. Returns true when a session was established.
 */
export async function completeSignInFromUrl(url: string): Promise<boolean> {
  const s = getSupabase();
  if (!s) return false;
  const { queryParams } = Linking.parse(url);
  const code = queryParams?.code;
  if (typeof code === 'string' && code.length > 0) {
    const { error } = await s.auth.exchangeCodeForSession(code);
    if (error) throw new Error(error.message);
    return true;
  }
  const errorDescription = queryParams?.error_description;
  if (typeof errorDescription === 'string') throw new Error(errorDescription);
  return false;
}

/** Sign out: clear the native Google session (so the picker shows next time) and the Supabase session. */
export async function signOut(): Promise<void> {
  await signOutGoogleAccount();
  const s = getSupabase();
  if (s) await s.auth.signOut();
}

/** The current session (from persisted storage), or null. */
export async function getCurrentSession(): Promise<Session | null> {
  const s = getSupabase();
  if (!s) return null;
  const { data } = await s.auth.getSession();
  return data.session;
}

/** Subscribe to session changes. Returns an unsubscribe function. */
export function onAuthChange(callback: (session: Session | null) => void): () => void {
  const s = getSupabase();
  if (!s) return () => {};
  const { data } = s.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
