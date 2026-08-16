/**
 * Auth actions (Step 1 login) on top of Supabase: Google (native ID-token) sign-in and email
 * 6-digit OTP. The session itself lives in the Supabase client (persisted in AsyncStorage); these
 * are just the verbs the UI calls.
 */

import type { Session } from '@supabase/supabase-js';

import { signInWithGoogle } from './google';
import { getSupabase } from './supabase';

function requireSupabase() {
  const s = getSupabase();
  if (!s) throw new Error('Sign-in isn’t configured yet.');
  return s;
}

/**
 * Sign in with Google: native Google picker → ID token → Supabase session. Returns false if the
 * user cancels the Google picker.
 */
export async function signInWithGoogleAccount(): Promise<boolean> {
  const identity = await signInWithGoogle();
  if (!identity) return false;
  const { error } = await requireSupabase().auth.signInWithIdToken({
    provider: 'google',
    token: identity.idToken,
  });
  if (error) throw new Error(error.message);
  return true;
}

/** Email a 6-digit sign-in code (creating the user if new). */
export async function sendEmailOtp(email: string): Promise<void> {
  const { error } = await requireSupabase().auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw new Error(error.message);
}

/** Verify the 6-digit email code, establishing a session. */
export async function verifyEmailOtp(email: string, code: string): Promise<void> {
  const { error } = await requireSupabase().auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw new Error(error.message);
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
