/**
 * Supabase project config for auth (Step 1 login).
 *
 * The URL and anon key are PUBLIC (the anon key is safe to ship — it only grants what your
 * Row-Level-Security policies allow), so they're fine to commit. Fill these in from your Supabase
 * project's Settings → API. Until they're set, {@link isSupabaseConfigured} returns false and the
 * app skips the login gate so it stays usable during setup.
 */

// Project base URL (no `/rest/v1/` suffix — the SDK appends its own paths).
export const SUPABASE_URL = 'https://utfhnxdhavemxlzagiaf.supabase.co';
// Publishable key (the new name for the anon/public key) — safe to ship; guarded by RLS.
export const SUPABASE_ANON_KEY = 'sb_publishable_-_IbeOqe3kahIdvjTv-YVg_HRdkvjF5';

/**
 * DEV ONLY: skip the login gate. The emulator can't complete Google sign-in, so this lets us
 * debug the UI there. `__DEV__` is false in every release build, so this can NEVER ship enabled —
 * flip it to `false` if you want to test the real login flow on a dev device.
 */
export const DEV_BYPASS_LOGIN = __DEV__;

/** True once real Supabase credentials have been filled in (not the placeholders). */
export function isSupabaseConfigured(): boolean {
  return (
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('YOUR_PROJECT') &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.includes('YOUR_ANON')
  );
}
