/**
 * Google Sign-In wiring for Drive backup (Step 8, Drive part).
 *
 * The app has no general login (Step 1 isn't built), so this is the first and only place we sign
 * the user in — purely to get an access token scoped to `drive.file` for backup/restore. We keep
 * the surface tiny: make sure we're signed in (silently if possible), and hand back an access
 * token for the REST calls.
 */

import { GoogleSignin, type User } from '@react-native-google-signin/google-signin';

import { DRIVE_FILE_SCOPE } from '@/core/drive';
import { WEB_CLIENT_ID } from './config';

/** The signed-in Google account, trimmed to what we show in the UI. */
export interface DriveAccount {
  email: string;
  name: string | null;
}

let configured = false;

/** Configure Google Sign-In once (idempotent). Requests only the least-privileged Drive scope. */
function ensureConfigured(): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    scopes: [DRIVE_FILE_SCOPE],
    // We use the access token directly from the device — no backend, so no offline/refresh token.
    offlineAccess: false,
  });
  configured = true;
}

function toAccount(u: User): DriveAccount {
  return { email: u.user.email, name: u.user.name };
}

/** Make sure the granted scopes include Drive access; request it if a prior sign-in lacked it. */
async function withDriveScope(u: User): Promise<DriveAccount> {
  if (u.scopes?.includes(DRIVE_FILE_SCOPE)) return toAccount(u);
  const res = await GoogleSignin.addScopes({ scopes: [DRIVE_FILE_SCOPE] });
  return res && res.type === 'success' ? toAccount(res.data) : toAccount(u);
}

/**
 * Ensure the user is signed in and has granted Drive access. Tries a silent sign-in first (no UI
 * if they've signed in before), then falls back to the interactive account picker. Returns null if
 * the user cancels the sign-in.
 */
export async function ensureSignedIn(): Promise<DriveAccount | null> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const silent = await GoogleSignin.signInSilently();
  if (silent.type === 'success') return withDriveScope(silent.data);

  const res = await GoogleSignin.signIn();
  if (res.type === 'success') return withDriveScope(res.data);
  return null; // cancelled
}

/** The currently signed-in account (no network / no prompt), or null. */
export function currentAccount(): DriveAccount | null {
  const u = GoogleSignin.getCurrentUser();
  return u ? toAccount(u) : null;
}

/** Fetch a fresh OAuth access token for the Drive REST calls. Caller must be signed in first. */
export async function getAccessToken(): Promise<string> {
  ensureConfigured();
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

/** Sign the user out (forgets the account; next backup will prompt again). */
export async function signOutDrive(): Promise<void> {
  ensureConfigured();
  await GoogleSignin.signOut();
}
