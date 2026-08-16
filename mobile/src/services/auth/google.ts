/**
 * Shared Google Sign-In configuration + interactive sign-in, used by BOTH the login flow (Step 1,
 * for a Supabase ID token) and Drive backup (Step 8, for the access token). Configuring in one
 * place avoids the two features fighting over `GoogleSignin.configure`.
 *
 * We request the `drive.file` scope up front so a single consent covers both signing in and
 * backing up to Drive.
 */

import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { DRIVE_FILE_SCOPE } from '@/core/drive';
import { WEB_CLIENT_ID } from '@/services/drive/config';

let configured = false;

/** Configure Google Sign-In once (idempotent). `webClientId` is what lets us mint an ID token. */
export function configureGoogleSignin(): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    scopes: [DRIVE_FILE_SCOPE],
    offlineAccess: false,
  });
  configured = true;
}

export interface GoogleIdentity {
  /** ID token (JWT) to hand to Supabase's `signInWithIdToken`. */
  idToken: string;
  email: string;
  name: string | null;
}

/**
 * Interactive Google sign-in. Returns the ID token + basic profile, or null if the user cancels.
 * Throws if Play Services is missing or Google returns no ID token.
 */
export async function signInWithGoogle(): Promise<GoogleIdentity | null> {
  configureGoogleSignin();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (res.type !== 'success') return null; // cancelled
  const { idToken, user } = res.data;
  if (!idToken) throw new Error('Google did not return an ID token.');
  return { idToken, email: user.email, name: user.name };
}
