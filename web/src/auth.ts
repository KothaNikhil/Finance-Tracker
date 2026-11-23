import { createClient } from '@supabase/supabase-js';
import { DRIVE_FILE_SCOPE, GOOGLE_CLIENT_ID, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    flowType: 'pkce',
  },
});

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        callback(response: GoogleTokenResponse): void;
      }): GoogleTokenClient;
      revoke(token: string, callback: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let googleScript: Promise<void> | null = null;

async function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google) return window.google;
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => (window.google ? resolve() : reject(new Error('Google Identity Services did not initialize.')));
      script.onerror = () => reject(new Error('Could not load Google Identity Services.'));
      document.head.append(script);
    });
  }
  await googleScript;
  if (!window.google) throw new Error('Google Identity Services is unavailable.');
  return window.google;
}

export async function requestDriveAccessToken(): Promise<string> {
  const google = await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? 'Google Drive authorization failed.'));
          return;
        }
        resolve(response.access_token);
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export async function revokeDriveAccessToken(token: string | null): Promise<void> {
  if (!token || !window.google) return;
  await new Promise<void>((resolve) => window.google?.accounts.oauth2.revoke(token, resolve));
}
