import { createBrowserClient } from '@supabase/ssr';

/**
 * Validates if a URL is properly formatted
 */
function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates if the Supabase URL looks like a valid Supabase project URL
 */
function isValidSupabaseUrl(url: string): boolean {
  if (!isValidUrl(url)) {
    return false;
  }
  
  // Check if URL contains .supabase.co domain
  return url.includes('.supabase.co');
}

export function createClient() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Check if environment variables are present
  if (!supabaseUrl || !supabaseAnonKey) {
    const errorMessage = `
❌ Missing Supabase environment variables!

Please ensure the following are set in your .env.development file:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

Example:
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

See .env.example for a template.
    `.trim();
    throw new Error(errorMessage);
  }

  // Validate URL format
  if (!isValidUrl(supabaseUrl)) {
    const errorMessage = `
❌ Invalid Supabase URL format!

Current value: ${supabaseUrl}

The URL must be a valid HTTP/HTTPS URL.
Example: https://your-project.supabase.co

Please check your .env.development file and update VITE_SUPABASE_URL.
    `.trim();
    throw new Error(errorMessage);
  }

  // Validate it's a Supabase URL
  if (!isValidSupabaseUrl(supabaseUrl)) {
    const errorMessage = `
❌ Invalid Supabase project URL!

Current value: ${supabaseUrl}

The URL must be a valid Supabase project URL (should contain .supabase.co).
Example: https://your-project.supabase.co

Common issues:
1. The Supabase project may have been deleted or paused
2. You may be using an incorrect URL
3. You need to create a new Supabase project

To fix:
1. Go to https://supabase.com/dashboard
2. Create a new project or select an existing one
3. Copy the Project URL from Settings → API
4. Update VITE_SUPABASE_URL in your .env.development file

See README.md for setup instructions.
    `.trim();
    throw new Error(errorMessage);
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
