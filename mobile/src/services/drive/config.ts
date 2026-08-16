/**
 * Google OAuth client identifiers.
 *
 * These are PUBLIC client identifiers, not secrets — they're safe to commit and ship in the app
 * (Google authenticates the Android app by its package name + signing certificate SHA-1, which are
 * registered on the Android OAuth client in the Google Cloud console). The `webClientId` is what
 * the Google Sign-In library needs to mint tokens.
 *
 * Do NOT put an OAuth *client secret* here — the mobile app doesn't use one.
 */

/** Web application OAuth client ID (from Google Cloud → Credentials). Public, safe to commit. */
export const WEB_CLIENT_ID =
  '117169471675-9dgo05ecj64rrqef0qgciatrg24043lv.apps.googleusercontent.com';
