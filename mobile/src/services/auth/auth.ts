/**
 * Auth actions (Step 1 login) on top of Supabase: Google (native ID-token) sign-in and email
 * 6-digit OTP. The session itself lives in the Supabase client (persisted in AsyncStorage); these
 * are just the verbs the UI calls.
 */

import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { getSupabase } from './supabase';

// Google-account sign-in is platform-split: native uses the Google picker + ID token, web uses a
// Supabase OAuth redirect. Re-exported here so callers keep importing it from `@/services/auth/auth`.
export { signInWithGoogleAccount } from './google-account';

/**
 * Deep link the email magic link redirects back to. Must be listed in Supabase →
 * Authentication → URL Configuration → Redirect URLs. Uses the app's `mobile` scheme (app.json).
 */
export const AUTH_REDIRECT = 'mobile://auth-callback';

function requireSupabase() {
  const s = getSupabase();
  if (!s) throw new Error('Sign-in isn’t configured yet.');
  return s;
}

/**
 * Email a magic sign-in link (creating the user if new). The link redirects back into the app via
 * {@link AUTH_REDIRECT}; {@link completeSignInFromUrl} finishes the sign-in. The email must be
 * opened on THIS device so the link can hand off to the app.
 */
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await requireSupabase().auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: AUTH_REDIRECT, shouldCreateUser: true },
  });
  if (error) throw new Error(error.message);
}

/**
 * Finish a magic-link sign-in from the deep-link URL the app was opened with. Exchanges the
 * `?code=...` for a session (PKCE). Returns true when a session was established.
 */
export async function completeSignInFromUrl(url: string): Promise<boolean> {
  const { queryParams } = Linking.parse(url);
  const code = queryParams?.code;
  if (typeof code === 'string' && code.length > 0) {
    const { error } = await requireSupabase().auth.exchangeCodeForSession(code);
    if (error) throw new Error(error.message);
    return true;
  }
  const errorDescription = queryParams?.error_description;
  if (typeof errorDescription === 'string') throw new Error(errorDescription);
  return false;
}

/** Sign out of Supabase (does not sign out of the native Google account used for Drive). */
export async function signOut(): Promise<void> {
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
