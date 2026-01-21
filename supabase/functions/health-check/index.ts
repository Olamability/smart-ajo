/**
 * Health Check Edge Function
 * 
 * This function provides a comprehensive health check endpoint for the application.
 * It verifies that critical services are operational and returns system status.
 * 
 * ✅ WHAT THIS FUNCTION DOES:
 * 1. Checks Supabase database connectivity
 * 2. Verifies Auth service is accessible
 * 3. Returns system health metrics
 * 4. Provides detailed component status
 * 
 * Security:
 * - No authentication required (public health check)
 * - Does not expose sensitive information
 * - Safe to call frequently for monitoring
 * 
 * Usage:
 * GET /health-check
 * Returns: { status: "healthy", components: {...}, timestamp: "..." }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours (86400 seconds)
};

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  components: {
    database: ComponentStatus;
    auth: ComponentStatus;
    edgeFunctions: ComponentStatus;
  };
}

interface ComponentStatus {
  status: 'operational' | 'degraded' | 'down';
  responseTime?: number;
  message?: string;
  error?: string;
}

/**
 * Check database connectivity
 */
async function checkDatabase(supabase: SupabaseClient): Promise<ComponentStatus> {
  const startTime = Date.now();
  
  try {
    // Simple query to check database is accessible
    const { error } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    
    const responseTime = Date.now() - startTime;
    
    if (error) {
      console.error('Database health check failed:', error);
      return {
        status: 'down',
        responseTime,
        error: 'Database query failed',
      };
    }
    
    return {
      status: 'operational',
      responseTime,
      message: 'Database is accessible',
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('Database health check exception:', error);
    return {
      status: 'down',
      responseTime,
      error: error instanceof Error ? error.message : 'Database connection failed',
    };
  }
}

/**
 * Check Auth service status
 */
async function checkAuth(): Promise<ComponentStatus> {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    try {
      // Check if we can reach the auth health endpoint
      const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;
      
      if (!response.ok) {
        return {
          status: 'degraded',
          responseTime,
          error: `Auth service returned ${response.status}`,
        };
      }
      
      return {
        status: 'operational',
        responseTime,
        message: 'Auth service is accessible',
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Handle timeout
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        const responseTime = Date.now() - startTime;
        return {
          status: 'down',
          responseTime,
          error: 'Auth service request timed out',
        };
      }
      
      throw fetchError;
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('Auth health check failed:', error);
    return {
      status: 'down',
      responseTime,
      error: error instanceof Error ? error.message : 'Auth service unavailable',
    };
  }
}

/**
 * Check Edge Functions deployment status
 */
function checkEdgeFunctions(): ComponentStatus {
  // This function itself is an Edge Function, so if it's running, 
  // Edge Functions are operational
  return {
    status: 'operational',
    message: 'Edge Functions are deployed and running',
  };
}

/**
 * Determine overall system health
 */
function determineOverallHealth(components: HealthCheckResponse['components']): 'healthy' | 'degraded' | 'unhealthy' {
  const statuses = [
    components.database.status,
    components.auth.status,
    components.edgeFunctions.status,
  ];
  
  // If any component is down, system is unhealthy
  if (statuses.includes('down')) {
    return 'unhealthy';
  }
  
  // If any component is degraded, system is degraded
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  
  // All components operational
  return 'healthy';
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ 
        error: 'Method not allowed',
        message: 'Only GET requests are supported',
      }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    console.log('===== HEALTH CHECK START =====');
    console.log('Timestamp:', new Date().toISOString());
    
    // Get Supabase configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase configuration missing');
      const response: HealthCheckResponse = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        components: {
          database: {
            status: 'down',
            error: 'Configuration error',
          },
          auth: {
            status: 'down',
            error: 'Configuration error',
          },
          edgeFunctions: {
            status: 'operational',
          },
        },
      };
      
      return new Response(
        JSON.stringify(response),
        {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create Supabase client for health checks
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Perform health checks in parallel
    const [databaseStatus, authStatus] = await Promise.all([
      checkDatabase(supabase),
      checkAuth(),
    ]);
    
    const edgeFunctionsStatus = checkEdgeFunctions();
    
    const components = {
      database: databaseStatus,
      auth: authStatus,
      edgeFunctions: edgeFunctionsStatus,
    };
    
    const overallStatus = determineOverallHealth(components);
    
    const response: HealthCheckResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      components,
    };
    
    console.log('Health check result:', overallStatus);
    console.log('Components:', JSON.stringify(components, null, 2));
    console.log('===== HEALTH CHECK END =====');
    
    // Return appropriate HTTP status based on health
    const httpStatus = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'degraded' ? 200 : 503;
    
    return new Response(
      JSON.stringify(response),
      {
        status: httpStatus,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('===== HEALTH CHECK ERROR =====');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('Error stack:', error.stack);
    }
    console.error('===== END ERROR =====');
    
    const response: HealthCheckResponse = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      components: {
        database: {
          status: 'down',
          error: 'Health check failed',
        },
        auth: {
          status: 'down',
          error: 'Health check failed',
        },
        edgeFunctions: {
          status: 'degraded',
          error: 'Health check exception',
        },
      },
    };
    
    return new Response(
      JSON.stringify(response),
      {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
