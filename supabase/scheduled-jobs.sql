-- ============================================================================
-- SECURED-AJO SCHEDULED JOBS (pg_cron)
-- ============================================================================
-- This file contains scheduled job configurations for automated tasks.
-- Uses pg_cron extension for scheduling background jobs.
--
-- IMPORTANT: 
-- 1. pg_cron must be enabled in Supabase (available on Pro plan and above)
-- 2. Run this file after schema.sql and functions.sql
-- 3. Jobs run in UTC timezone
-- ============================================================================

-- ============================================================================
-- ENABLE pg_cron EXTENSION
-- ============================================================================
-- Note: This may require superuser privileges
-- On Supabase, enable via Dashboard > Database > Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres role (Supabase default)
GRANT USAGE ON SCHEMA cron TO postgres;

-- ============================================================================
-- JOB 1: Apply Late Penalties
-- ============================================================================
-- Runs daily at 1:00 AM UTC
-- Checks for overdue contributions and applies penalties
-- ============================================================================

SELECT cron.schedule(
  'apply-late-penalties',           -- Job name
  '0 1 * * *',                      -- Cron schedule (1 AM daily)
  $$
    SELECT apply_late_penalties();
  $$
);

COMMENT ON EXTENSION pg_cron IS 
  'Job: apply-late-penalties runs daily at 1 AM UTC';

-- ============================================================================
-- JOB 2: Process Complete Cycles
-- ============================================================================
-- Runs every 6 hours
-- Checks for completed cycles and processes payouts
-- ============================================================================

SELECT cron.schedule(
  'process-complete-cycles',        -- Job name
  '0 */6 * * *',                    -- Cron schedule (Every 6 hours)
  $$
    SELECT check_and_process_complete_cycles();
  $$
);

-- ============================================================================
-- JOB 2b: Process Pending Payouts
-- ============================================================================
-- Runs every 2 hours
-- Executes pending payouts via Paystack transfer API
-- 
-- NOTE: This requires the process-payouts Edge Function to be deployed
-- Alternative: Call the Edge Function via HTTP from external cron service
--
-- IMPORTANT: pg_net extension must be enabled for http requests from cron
-- Enable via: CREATE EXTENSION IF NOT EXISTS pg_net;
-- ============================================================================

-- Uncomment when pg_net extension is available:
/*
SELECT cron.schedule(
  'process-pending-payouts',        -- Job name
  '0 */2 * * *',                    -- Cron schedule (Every 2 hours)
  $$
    SELECT net.http_post(
      url := CURRENT_SETTING('app.supabase_url') || '/functions/v1/process-payouts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || CURRENT_SETTING('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
*/

-- Alternative: External cron service (e.g., GitHub Actions, cron-job.org)
-- Schedule HTTP POST to: https://YOUR_PROJECT.supabase.co/functions/v1/process-payouts
-- Headers: Authorization: Bearer YOUR_SERVICE_ROLE_KEY

-- ============================================================================
-- JOB 3: Send Payment Reminders
-- ============================================================================
-- Runs daily at 9:00 AM UTC (10 AM WAT for Nigerian users)
-- Sends reminders for upcoming and overdue payments
-- ============================================================================

SELECT cron.schedule(
  'send-payment-reminders',         -- Job name
  '0 9 * * *',                      -- Cron schedule (9 AM daily)
  $$
    SELECT send_payment_reminders();
  $$
);

-- ============================================================================
-- JOB 4: Clean Old Notifications
-- ============================================================================
-- Runs weekly on Sunday at 2:00 AM UTC
-- Deletes read notifications older than 30 days
-- ============================================================================

SELECT cron.schedule(
  'clean-old-notifications',        -- Job name
  '0 2 * * 0',                      -- Cron schedule (2 AM on Sundays)
  $$
    DELETE FROM notifications 
    WHERE is_read = true 
    AND created_at < NOW() - INTERVAL '30 days';
  $$
);

-- ============================================================================
-- JOB 5: Clean Expired Verification Tokens
-- ============================================================================
-- Runs daily at 3:00 AM UTC
-- Deletes expired and used email verification tokens
-- ============================================================================

SELECT cron.schedule(
  'clean-expired-tokens',           -- Job name
  '0 3 * * *',                      -- Cron schedule (3 AM daily)
  $$
    DELETE FROM email_verification_tokens 
    WHERE expires_at < NOW() 
    OR (used = true AND created_at < NOW() - INTERVAL '7 days');
  $$
);

-- ============================================================================
-- JOB 6: Update Group Status
-- ============================================================================
-- Runs every hour
-- Updates group status from 'forming' to 'active' when start date arrives
-- ============================================================================

SELECT cron.schedule(
  'update-group-status',            -- Job name
  '0 * * * *',                      -- Cron schedule (Every hour)
  $$
    UPDATE groups 
    SET status = 'active',
        updated_at = NOW()
    WHERE status = 'forming' 
    AND start_date <= NOW()
    AND current_members = total_members;
  $$
);

-- ============================================================================
-- JOB 7: Archive Completed Groups
-- ============================================================================
-- Runs weekly on Monday at 4:00 AM UTC
-- Archives groups that have been completed for more than 90 days
-- Note: This job just adds metadata, doesn't delete data
-- ============================================================================

SELECT cron.schedule(
  'archive-completed-groups',       -- Job name
  '0 4 * * 1',                      -- Cron schedule (4 AM on Mondays)
  $$
    UPDATE groups 
    SET status = 'archived',
        updated_at = NOW()
    WHERE status = 'completed' 
    AND updated_at < NOW() - INTERVAL '90 days';
  $$
);

-- ============================================================================
-- JOB 8: Generate Daily Statistics
-- ============================================================================
-- Runs daily at 5:00 AM UTC
-- Generates and stores daily platform statistics
-- ============================================================================

SELECT cron.schedule(
  'generate-daily-stats',           -- Job name
  '0 5 * * *',                      -- Cron schedule (5 AM daily)
  $$
    INSERT INTO audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      details,
      ip_address
    )
    SELECT 
      NULL,
      'system_stats',
      'platform',
      gen_random_uuid(),
      jsonb_build_object(
        'date', CURRENT_DATE,
        'total_users', (SELECT COUNT(*) FROM users),
        'active_groups', (SELECT COUNT(*) FROM groups WHERE status = 'active'),
        'total_contributions', (SELECT COUNT(*) FROM contributions WHERE status = 'paid'),
        'total_volume', (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed')
      ),
      '127.0.0.1'
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_logs 
      WHERE action = 'system_stats' 
      AND created_at::date = CURRENT_DATE
    );
  $$
);

-- ============================================================================
-- VIEW: Scheduled Jobs Status
-- ============================================================================
-- View to monitor scheduled jobs
-- ============================================================================

CREATE OR REPLACE VIEW cron_jobs_status AS
SELECT 
  jobid,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active,
  jobname
FROM cron.job
ORDER BY jobid;

COMMENT ON VIEW cron_jobs_status IS 
  'Shows status of all scheduled cron jobs';

-- Grant access to view
GRANT SELECT ON cron_jobs_status TO authenticated;
GRANT ALL ON cron_jobs_status TO service_role;

-- ============================================================================
-- MANAGEMENT FUNCTIONS
-- ============================================================================

-- Function to view job run history
CREATE OR REPLACE FUNCTION get_job_run_history(p_job_name TEXT DEFAULT NULL)
RETURNS TABLE (
  runid BIGINT,
  jobid BIGINT,
  job_name TEXT,
  database TEXT,
  username TEXT,
  command TEXT,
  status TEXT,
  return_message TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration INTERVAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    jr.runid,
    jr.jobid,
    j.jobname,
    jr.database,
    jr.username,
    jr.command,
    jr.status,
    jr.return_message,
    jr.start_time,
    jr.end_time,
    (jr.end_time - jr.start_time) AS duration
  FROM cron.job_run_details jr
  JOIN cron.job j ON jr.jobid = j.jobid
  WHERE p_job_name IS NULL OR j.jobname = p_job_name
  ORDER BY jr.start_time DESC
  LIMIT 100;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_job_run_history IS 
  'Returns execution history for scheduled jobs';

-- Function to manually trigger a job
CREATE OR REPLACE FUNCTION trigger_scheduled_job(p_job_name TEXT)
RETURNS JSONB AS $$
DECLARE
  v_command TEXT;
  v_result TEXT;
BEGIN
  -- Get job command
  SELECT command INTO v_command
  FROM cron.job
  WHERE jobname = p_job_name;
  
  IF v_command IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Job not found: ' || p_job_name
    );
  END IF;
  
  -- Execute the command
  EXECUTE v_command INTO v_result;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Job executed successfully',
    'job_name', p_job_name,
    'result', v_result
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Job execution failed: ' || SQLERRM,
      'job_name', p_job_name
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trigger_scheduled_job IS 
  'Manually triggers a scheduled job for testing or immediate execution';

-- ============================================================================
-- UNSCHEDULING JOBS (for maintenance)
-- ============================================================================
-- Uncomment to remove specific jobs if needed

-- To unschedule a job:
-- SELECT cron.unschedule('job-name-here');

-- To unschedule all jobs:
-- SELECT cron.unschedule(jobid) FROM cron.job;

-- ============================================================================
-- ALTERNATIVE: Supabase Edge Functions (if pg_cron not available)
-- ============================================================================
-- If pg_cron is not available (e.g., on Supabase free tier), 
-- you can implement these jobs as Supabase Edge Functions triggered by:
-- 1. External cron services (e.g., GitHub Actions, cron-job.org)
-- 2. Supabase Database Webhooks
-- 3. Manual API calls from your application
--
-- Example Edge Function structure:
-- 
-- // File: supabase/functions/apply-penalties/index.ts
-- import { createClient } from '@supabase/supabase-js'
-- 
-- Deno.serve(async (req) => {
--   const supabaseClient = createClient(
--     Deno.env.get('SUPABASE_URL'),
--     Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
--   )
--   
--   const { data, error } = await supabaseClient.rpc('apply_late_penalties')
--   
--   return new Response(JSON.stringify({ data, error }), {
--     headers: { 'Content-Type': 'application/json' },
--   })
-- })
--
-- Then call via HTTP:
-- curl -X POST https://your-project.supabase.co/functions/v1/apply-penalties \
--   -H "Authorization: Bearer YOUR_ANON_KEY"
-- ============================================================================

-- ============================================================================
-- MONITORING QUERIES
-- ============================================================================

-- Check if pg_cron is enabled
-- SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- View all scheduled jobs
-- SELECT * FROM cron.job;

-- View recent job runs
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- View failed jobs
-- SELECT * FROM cron.job_run_details WHERE status = 'failed' ORDER BY start_time DESC;

-- View job run statistics
-- SELECT 
--   j.jobname,
--   COUNT(*) as total_runs,
--   COUNT(CASE WHEN jr.status = 'succeeded' THEN 1 END) as successful_runs,
--   COUNT(CASE WHEN jr.status = 'failed' THEN 1 END) as failed_runs,
--   AVG(EXTRACT(EPOCH FROM (jr.end_time - jr.start_time))) as avg_duration_seconds
-- FROM cron.job_run_details jr
-- JOIN cron.job j ON jr.jobid = j.jobid
-- GROUP BY j.jobname;

-- ============================================================================
-- END OF SCHEDULED JOBS
-- ============================================================================
--
-- SETUP INSTRUCTIONS:
-- 1. Ensure pg_cron extension is enabled in Supabase
--    - Go to Database > Extensions
--    - Enable "pg_cron"
-- 2. Run this file after schema.sql and functions.sql
-- 3. Verify jobs are scheduled: SELECT * FROM cron.job;
-- 4. Monitor job execution: SELECT * FROM get_job_run_history();
-- 5. Manually trigger for testing: SELECT trigger_scheduled_job('job-name');
--
-- NOTES:
-- - All times are in UTC
-- - Jobs run with the postgres role privileges
-- - Failed jobs are logged in cron.job_run_details
-- - Adjust schedules based on your timezone and requirements
-- - Monitor job performance and adjust as needed
-- - Consider rate limiting for notification jobs
--
-- ============================================================================
