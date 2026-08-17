/**
 * Google-account sign-in on NATIVE (iOS/Android): the native Google picker mints an ID token,
 * which we hand to Supabase's `signInWithIdToken`. The web build resolves `google-account.web.ts`
 * instead (a browser OAuth redirect), because `@react-native-google-signin` is a native-only
 * module with no browser implementation.
 */

import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { signInWithGoogle } from './google';
import { getSupabase } from './supabase';

/**
 * Sign in with Google: native Google picker → ID token → Supabase session. Returns false if the
 * user cancels the Google picker.
 */
export async function signInWithGoogleAccount(): Promise<boolean> {
  const identity = await signInWithGoogle();
  if (!identity) return false;
  const supabase = getSupabase();
  if (!supabase) throw new Error('Sign-in isn’t configured yet.');
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: identity.idToken,
  });
  if (error) throw new Error(error.message);
  return true;
}

/**
 * Clear the native Google session on sign-out so no account lingers signed-in while the app is
 * logged out. (The picker is also forced at sign-in time — see `signInWithGoogle`.)
 */
export async function signOutGoogleAccount(): Promise<void> {
  await GoogleSignin.signOut().catch(() => {});
}
