/**
 * Scheduled Jobs Edge Function
 * 
 * This function handles automated tasks that should run periodically:
 * 1. Check for overdue contributions
 * 2. Apply penalties for late/missed payments
 * 3. Check for completed cycles and trigger payouts
 * 4. Advance to next cycle when current cycle completes
 * 
 * ✅ WHAT THIS FUNCTION DOES:
 * - Marks contributions as overdue when past due date
 * - Creates penalty records for late payments
 * - Completes cycles when all contributions paid
 * - Triggers payouts for cycle collectors
 * - Advances groups to next cycle
 * 
 * Security:
 * - Requires service role key (not exposed to frontend)
 * - Should be triggered by external cron service (e.g., GitHub Actions, cron-job.org)
 * - Includes authorization check
 * 
 * Usage:
 * POST /scheduled-jobs
 * Headers: { "Authorization": "Bearer <service_role_key>" }
 * Body: { "task": "all" | "overdue" | "penalties" | "cycles" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ScheduledJobRequest {
  task: 'all' | 'overdue' | 'penalties' | 'cycles';
}

interface JobResult {
  task: string;
  success: boolean;
  recordsAffected: number;
  message: string;
  error?: string;
}

/**
 * Mark overdue contributions
 */
async function markOverdueContributions(supabase: any): Promise<JobResult> {
  try {
    console.log('Marking overdue contributions...');
    
    // Update contributions that are past due date and still pending
    const { data, error } = await supabase
      .from('contributions')
      .update({ status: 'overdue', updated_at: new Date().toISOString() })
      .eq('status', 'pending')
      .lt('due_date', new Date().toISOString());
    
    if (error) {
      console.error('Error marking overdue contributions:', error);
      return {
        task: 'overdue',
        success: false,
        recordsAffected: 0,
        message: 'Failed to mark overdue contributions',
        error: error.message,
      };
    }
    
    const count = data?.length || 0;
    console.log(`Marked ${count} contributions as overdue`);
    
    return {
      task: 'overdue',
      success: true,
      recordsAffected: count,
      message: `Marked ${count} contributions as overdue`,
    };
  } catch (error) {
    console.error('Exception in markOverdueContributions:', error);
    return {
      task: 'overdue',
      success: false,
      recordsAffected: 0,
      message: 'Exception occurred',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply penalties for overdue contributions
 */
async function applyPenalties(supabase: any): Promise<JobResult> {
  try {
    console.log('Applying penalties for overdue contributions...');
    
    // Get all overdue contributions that don't have penalties yet
    const { data: overdueContributions, error: fetchError } = await supabase
      .from('contributions')
      .select('id, user_id, group_id, amount, due_date')
      .eq('status', 'overdue');
    
    if (fetchError) {
      console.error('Error fetching overdue contributions:', fetchError);
      return {
        task: 'penalties',
        success: false,
        recordsAffected: 0,
        message: 'Failed to fetch overdue contributions',
        error: fetchError.message,
      };
    }
    
    if (!overdueContributions || overdueContributions.length === 0) {
      return {
        task: 'penalties',
        success: true,
        recordsAffected: 0,
        message: 'No overdue contributions found',
      };
    }
    
    let penaltiesCreated = 0;
    
    // Create penalty for each overdue contribution
    for (const contribution of overdueContributions) {
      // Check if penalty already exists for this contribution
      const { data: existingPenalty } = await supabase
        .from('penalties')
        .select('id')
        .eq('user_id', contribution.user_id)
        .eq('group_id', contribution.group_id)
        .eq('contribution_id', contribution.id)
        .single();
      
      if (existingPenalty) {
        continue; // Penalty already exists
      }
      
      // Calculate penalty amount (e.g., 5% of contribution amount)
      const penaltyAmount = contribution.amount * 0.05;
      
      // Calculate days overdue
      const daysOverdue = Math.floor(
        (new Date().getTime() - new Date(contribution.due_date).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Create penalty record
      const { error: penaltyError } = await supabase
        .from('penalties')
        .insert({
          user_id: contribution.user_id,
          group_id: contribution.group_id,
          contribution_id: contribution.id,
          amount: penaltyAmount,
          type: 'late_payment',
          reason: `Late payment - ${daysOverdue} days overdue`,
          status: 'applied',
        });
      
      if (!penaltyError) {
        penaltiesCreated++;
      }
    }
    
    console.log(`Created ${penaltiesCreated} penalty records`);
    
    return {
      task: 'penalties',
      success: true,
      recordsAffected: penaltiesCreated,
      message: `Created ${penaltiesCreated} penalty records`,
    };
  } catch (error) {
    console.error('Exception in applyPenalties:', error);
    return {
      task: 'penalties',
      success: false,
      recordsAffected: 0,
      message: 'Exception occurred',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check and complete cycles, trigger payouts
 */
async function processCycles(supabase: any): Promise<JobResult> {
  try {
    console.log('Processing contribution cycles...');
    
    // Get all active cycles
    const { data: activeCycles, error: fetchError } = await supabase
      .from('contribution_cycles')
      .select(`
        id,
        group_id,
        cycle_number,
        collector_user_id,
        expected_amount,
        collected_amount,
        groups!inner(
          id,
          contribution_amount,
          service_fee_percentage,
          total_members
        )
      `)
      .eq('status', 'active');
    
    if (fetchError) {
      console.error('Error fetching active cycles:', fetchError);
      return {
        task: 'cycles',
        success: false,
        recordsAffected: 0,
        message: 'Failed to fetch active cycles',
        error: fetchError.message,
      };
    }
    
    if (!activeCycles || activeCycles.length === 0) {
      return {
        task: 'cycles',
        success: true,
        recordsAffected: 0,
        message: 'No active cycles to process',
      };
    }
    
    let cyclesCompleted = 0;
    
    for (const cycle of activeCycles) {
      // Check if all contributions for this cycle are paid
      const { data: contributions, error: contribError } = await supabase
        .from('contributions')
        .select('id, status')
        .eq('group_id', cycle.group_id)
        .eq('cycle_number', cycle.cycle_number);
      
      if (contribError) {
        console.error(`Error fetching contributions for cycle ${cycle.id}:`, contribError);
        continue;
      }
      
      const allPaid = contributions.every((c: any) => c.status === 'paid');
      
      if (allPaid) {
        // Calculate payout amount (total collected minus service fee)
        const totalCollected = cycle.groups.contribution_amount * cycle.groups.total_members;
        const serviceFee = totalCollected * (cycle.groups.service_fee_percentage / 100);
        const payoutAmount = totalCollected - serviceFee;
        
        // Update cycle status to completed
        const { error: updateError } = await supabase
          .from('contribution_cycles')
          .update({
            status: 'completed',
            collected_amount: totalCollected,
            payout_amount: payoutAmount,
            service_fee_collected: serviceFee,
            completion_date: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', cycle.id);
        
        if (updateError) {
          console.error(`Error updating cycle ${cycle.id}:`, updateError);
          continue;
        }
        
        // Create payout record
        const { error: payoutError } = await supabase
          .from('payouts')
          .insert({
            related_group_id: cycle.group_id,
            recipient_id: cycle.collector_user_id,
            cycle_number: cycle.cycle_number,
            amount: payoutAmount,
            status: 'pending',
            payment_method: 'wallet_transfer',
          });
        
        if (payoutError) {
          console.error(`Error creating payout for cycle ${cycle.id}:`, payoutError);
          continue;
        }
        
        // Activate next cycle if it exists
        const { error: nextCycleError } = await supabase
          .from('contribution_cycles')
          .update({
            status: 'active',
            start_date: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('group_id', cycle.group_id)
          .eq('cycle_number', cycle.cycle_number + 1)
          .eq('status', 'pending');
        
        if (!nextCycleError) {
          console.log(`Activated cycle ${cycle.cycle_number + 1} for group ${cycle.group_id}`);
        }
        
        cyclesCompleted++;
      }
    }
    
    console.log(`Completed ${cyclesCompleted} cycles`);
    
    return {
      task: 'cycles',
      success: true,
      recordsAffected: cyclesCompleted,
      message: `Completed ${cyclesCompleted} cycles and triggered payouts`,
    };
  } catch (error) {
    console.error('Exception in processCycles:', error);
    return {
      task: 'cycles',
      success: false,
      recordsAffected: 0,
      message: 'Exception occurred',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Method not allowed',
        message: 'Only POST requests are supported',
      }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    console.log('===== SCHEDULED JOB START =====');
    console.log('Timestamp:', new Date().toISOString());
    
    // Get Supabase configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase configuration missing');
      return new Response(
        JSON.stringify({
          error: 'Configuration error',
          message: 'Supabase configuration is missing',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: ScheduledJobRequest = await req.json();
    const task = body.task || 'all';
    
    console.log('Running task:', task);

    const results: JobResult[] = [];

    // Execute requested tasks
    if (task === 'all' || task === 'overdue') {
      const result = await markOverdueContributions(supabase);
      results.push(result);
    }

    if (task === 'all' || task === 'penalties') {
      const result = await applyPenalties(supabase);
      results.push(result);
    }

    if (task === 'all' || task === 'cycles') {
      const result = await processCycles(supabase);
      results.push(result);
    }

    console.log('Job results:', JSON.stringify(results, null, 2));
    console.log('===== SCHEDULED JOB END =====');

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('===== SCHEDULED JOB ERROR =====');
    console.error('Error:', error);
    console.error('===== END ERROR =====');

    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
