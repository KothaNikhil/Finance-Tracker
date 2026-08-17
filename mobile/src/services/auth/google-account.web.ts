/**
 * Google-account sign-in on WEB. `@react-native-google-signin` has no browser build, so instead we
 * use Supabase's OAuth redirect flow: the whole browser tab navigates to Google's consent screen
 * and back to this origin with a `?code=` (PKCE). The return is handled by the existing deep-link
 * path in `use-auth.tsx` (`completeSignInFromUrl` → `exchangeCodeForSession`), which already runs
 * on web because `Linking.getInitialURL()` returns `window.location.href`.
 *
 * A full-page redirect (not an embedded iframe) is unaffected by the COOP/COEP headers the dev
 * server sets for expo-sqlite's wasm, so those don't need to change.
 *
 * We request no extra scopes here (Drive backup is stubbed out on web — see
 * `services/drive/index.web.ts`), so the browser consent only asks for basic profile + email.
 */

import { getSupabase } from './supabase';

/**
 * Kick off the browser Google OAuth redirect. This resolves as the tab begins navigating away, so
 * the returned `true` never actually renders — the session is established on the return page load.
 */
export async function signInWithGoogleAccount(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Sign-in isn’t configured yet.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Return to wherever the app is being served (e.g. http://localhost:8081). This exact origin
      // MUST be listed in Supabase → Authentication → URL Configuration → Redirect URLs.
      redirectTo: window.location.origin,
    },
  });
  if (error) throw new Error(error.message);
  return true;
}
