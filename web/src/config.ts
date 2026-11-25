const env = import.meta.env;

export const SUPABASE_URL =
  env.VITE_SUPABASE_URL || 'https://utfhnxdhavemxlzagiaf.supabase.co';
export const SUPABASE_ANON_KEY =
  env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_-_IbeOqe3kahIdvjTv-YVg_HRdkvjF5';
export const GOOGLE_CLIENT_ID =
  env.VITE_GOOGLE_CLIENT_ID ||
  '117169471675-9dgo05ecj64rrqef0qgciatrg24043lv.apps.googleusercontent.com';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
