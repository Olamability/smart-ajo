/**
 * health-check Edge Function
 *
 * Lightweight uptime / liveness probe endpoint.
 *
 * GET /health-check
 *
 * Response (200):
 * {
 *   status: 'ok';
 *   timestamp: string;  // ISO 8601
 *   db: 'ok' | 'error'; // result of a lightweight DB ping
 *   version: string;    // service version tag
 * }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Semantic version of this edge function deployment */
const VERSION = '2.0.0';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const timestamp = new Date().toISOString();
  let dbStatus: 'ok' | 'error' = 'ok';

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Lightweight DB ping: count rows in a small system table
      const { error } = await supabase.from('groups').select('id', { count: 'exact', head: true });
      if (error) {
        console.error('[health-check] DB ping failed:', error.message);
        dbStatus = 'error';
      }
    } else {
      console.warn('[health-check] Supabase credentials not configured');
      dbStatus = 'error';
    }
  } catch (err) {
    console.error('[health-check] Unexpected error during DB ping:', err);
    dbStatus = 'error';
  }

  const httpStatus = dbStatus === 'ok' ? 200 : 503;

  return new Response(
    JSON.stringify({
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      timestamp,
      db: dbStatus,
      version: VERSION,
    }),
    {
      status: httpStatus,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
