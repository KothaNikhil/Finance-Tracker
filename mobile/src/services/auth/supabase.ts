/**
 * The Supabase client, used for auth only (Google ID-token sign-in + email OTP). The session is
 * persisted in AsyncStorage and auto-refreshed, so the user stays signed in across app launches.
 *
 * Supabase can later become the cloud database too; for now it's purely the auth backend.
 */

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

/** The shared Supabase client, created lazily. Null when Supabase isn't configured yet. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // No URL-based OAuth redirect on native — we use native Google + email OTP.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
