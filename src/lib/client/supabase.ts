import { createBrowserClient } from '@supabase/ssr';

// Singleton client instance – all parts of the app share the same Supabase
// client so they also share the same in-memory auth session. Without this,
// each `createClient()` call produces a fresh instance whose async cookie
// initialization may not have completed before `functions.invoke()` is called,
// causing the client to fall back to the anon key and triggering 401 errors
// from Edge Functions that require a real user JWT.
let _client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (_client) return _client;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env file.'
    );
  }

  _client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return _client;
}
