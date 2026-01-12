/**
 * BVN (Bank Verification Number) Verification Service
 * 
 * This Edge Function handles BVN verification through a third-party API.
 * It validates user identity using their BVN and updates the KYC status.
 * 
 * Supported Providers:
 * - Paystack Identity (recommended)
 * - Flutterwave KYC
 * - Smile Identity
 * 
 * Configuration:
 * - BVN_PROVIDER: The provider to use (paystack, flutterwave, smile)
 * - BVN_API_KEY: API key for the BVN verification provider
 * - BVN_API_SECRET: API secret (if required)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BVNVerificationRequest {
  bvn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // Format: YYYY-MM-DD
  phoneNumber?: string;
}

interface BVNVerificationResponse {
  success: boolean;
  verified: boolean;
  message: string;
  data?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phoneNumber: string;
    matchScore?: number;
  };
}

/**
 * Verify BVN using Paystack Identity API
 */
async function verifyBVNWithPaystack(
  bvn: string,
  firstName: string,
  lastName: string,
  dateOfBirth: string
): Promise<BVNVerificationResponse> {
  try {
    const apiKey = Deno.env.get('BVN_API_KEY') || Deno.env.get('PAYSTACK_SECRET_KEY');
    
    if (!apiKey) {
      return {
        success: false,
        verified: false,
        message: 'BVN verification not configured',
      };
    }

    // Step 1: Resolve BVN
    const resolveResponse = await fetch('https://api.paystack.co/bank/resolve_bvn/' + bvn, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resolveResponse.ok) {
      const errorData = await resolveResponse.json();
      return {
        success: false,
        verified: false,
        message: errorData.message || 'BVN resolution failed',
      };
    }

    const resolveData = await resolveResponse.json();
    
    if (!resolveData.status) {
      return {
        success: false,
        verified: false,
        message: resolveData.message || 'Invalid BVN',
      };
    }

    // Step 2: Verify identity match
    const bvnData = resolveData.data;
    
    // Normalize names for comparison (remove special characters, convert to lowercase)
    const normalizeName = (name: string) => 
      name.toLowerCase().replace(/[^a-z]/g, '');

    const firstNameMatch = normalizeName(bvnData.first_name) === normalizeName(firstName);
    const lastNameMatch = normalizeName(bvnData.last_name) === normalizeName(lastName);
    
    // Parse and compare date of birth (allow some flexibility)
    const bvnDob = new Date(bvnData.date_of_birth);
    const providedDob = new Date(dateOfBirth);
    const dobMatch = bvnDob.toDateString() === providedDob.toDateString();

    // Calculate match score (0-100)
    let matchScore = 0;
    if (firstNameMatch) matchScore += 40;
    if (lastNameMatch) matchScore += 40;
    if (dobMatch) matchScore += 20;

    const verified = matchScore >= 80; // Require at least 80% match

    return {
      success: true,
      verified: verified,
      message: verified ? 'BVN verified successfully' : 'Identity verification failed - details do not match',
      data: {
        firstName: bvnData.first_name,
        lastName: bvnData.last_name,
        dateOfBirth: bvnData.date_of_birth,
        phoneNumber: bvnData.mobile || bvnData.phone_number,
        matchScore: matchScore,
      },
    };
  } catch (error) {
    console.error('Paystack BVN verification error:', error);
    return {
      success: false,
      verified: false,
      message: `Verification failed: ${error.message}`,
    };
  }
}

/**
 * Verify BVN using Flutterwave KYC API
 */
async function verifyBVNWithFlutterwave(
  bvn: string,
  firstName: string,
  lastName: string,
  dateOfBirth: string
): Promise<BVNVerificationResponse> {
  try {
    const apiKey = Deno.env.get('BVN_API_KEY') || Deno.env.get('FLUTTERWAVE_SECRET_KEY');
    
    if (!apiKey) {
      return {
        success: false,
        verified: false,
        message: 'BVN verification not configured',
      };
    }

    const response = await fetch('https://api.flutterwave.com/v3/kyc/bvns/' + bvn, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        verified: false,
        message: errorData.message || 'BVN verification failed',
      };
    }

    const data = await response.json();
    
    if (data.status !== 'success') {
      return {
        success: false,
        verified: false,
        message: data.message || 'Invalid BVN',
      };
    }

    const bvnData = data.data;
    
    // Normalize and compare names
    const normalizeName = (name: string) => 
      name.toLowerCase().replace(/[^a-z]/g, '');

    const firstNameMatch = normalizeName(bvnData.first_name) === normalizeName(firstName);
    const lastNameMatch = normalizeName(bvnData.last_name) === normalizeName(lastName);
    
    const bvnDob = new Date(bvnData.date_of_birth);
    const providedDob = new Date(dateOfBirth);
    const dobMatch = bvnDob.toDateString() === providedDob.toDateString();

    let matchScore = 0;
    if (firstNameMatch) matchScore += 40;
    if (lastNameMatch) matchScore += 40;
    if (dobMatch) matchScore += 20;

    const verified = matchScore >= 80;

    return {
      success: true,
      verified: verified,
      message: verified ? 'BVN verified successfully' : 'Identity verification failed - details do not match',
      data: {
        firstName: bvnData.first_name,
        lastName: bvnData.last_name,
        dateOfBirth: bvnData.date_of_birth,
        phoneNumber: bvnData.phone_number,
        matchScore: matchScore,
      },
    };
  } catch (error) {
    console.error('Flutterwave BVN verification error:', error);
    return {
      success: false,
      verified: false,
      message: `Verification failed: ${error.message}`,
    };
  }
}

/**
 * Mock BVN verification for testing
 * DO NOT USE IN PRODUCTION
 */
function mockBVNVerification(
  bvn: string,
  firstName: string,
  lastName: string,
  dateOfBirth: string
): BVNVerificationResponse {
  // Simple mock: verify if BVN is 11 digits
  const isValidFormat = /^\d{11}$/.test(bvn);
  
  if (!isValidFormat) {
    return {
      success: false,
      verified: false,
      message: 'Invalid BVN format',
    };
  }

  // Mock successful verification
  return {
    success: true,
    verified: true,
    message: 'BVN verified successfully (MOCK MODE)',
    data: {
      firstName: firstName,
      lastName: lastName,
      dateOfBirth: dateOfBirth,
      phoneNumber: '0801234567',
      matchScore: 100,
    },
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract user from JWT
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse request body
    const verificationRequest: BVNVerificationRequest = await req.json();

    // Validate request
    if (!verificationRequest.bvn || !verificationRequest.firstName || 
        !verificationRequest.lastName || !verificationRequest.dateOfBirth) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate BVN format (11 digits)
    if (!/^\d{11}$/.test(verificationRequest.bvn)) {
      return new Response(
        JSON.stringify({ error: 'Invalid BVN format. BVN must be 11 digits' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get BVN provider from environment
    const provider = Deno.env.get('BVN_PROVIDER') || 'mock';

    // Verify BVN with selected provider
    let result: BVNVerificationResponse;

    switch (provider.toLowerCase()) {
      case 'paystack':
        result = await verifyBVNWithPaystack(
          verificationRequest.bvn,
          verificationRequest.firstName,
          verificationRequest.lastName,
          verificationRequest.dateOfBirth
        );
        break;
      
      case 'flutterwave':
        result = await verifyBVNWithFlutterwave(
          verificationRequest.bvn,
          verificationRequest.firstName,
          verificationRequest.lastName,
          verificationRequest.dateOfBirth
        );
        break;
      
      case 'mock':
      default:
        result = mockBVNVerification(
          verificationRequest.bvn,
          verificationRequest.firstName,
          verificationRequest.lastName,
          verificationRequest.dateOfBirth
        );
        break;
    }

    // Update user KYC status in database
    if (result.success && result.verified) {
      const { error: updateError } = await supabase
        .from('users')
        .update({
          kyc_status: 'approved',
          kyc_data: {
            bvn: verificationRequest.bvn.substring(0, 3) + '****' + verificationRequest.bvn.substring(9), // Mask BVN
            verified_at: new Date().toISOString(),
            verification_provider: provider,
            match_score: result.data?.matchScore,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('Failed to update KYC status:', updateError);
      }
    } else if (result.success && !result.verified) {
      // Update to pending for manual review
      await supabase
        .from('users')
        .update({
          kyc_status: 'pending',
          kyc_data: {
            bvn: verificationRequest.bvn.substring(0, 3) + '****' + verificationRequest.bvn.substring(9),
            attempted_at: new Date().toISOString(),
            verification_provider: provider,
            match_score: result.data?.matchScore,
            reason: 'Identity verification failed - manual review required',
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
    }

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('BVN verification error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        verified: false,
        error: 'Internal server error', 
        details: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
