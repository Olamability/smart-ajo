-- Migration: Background Jobs (pg_cron)
-- Date: 2026-03-15
-- Description:
--   Configures automated background jobs using pg_cron to drive the core
--   Smart Ajo business processes:
--
--   Job 1  – mark_overdue_contributions
--            Runs daily at 00:05 UTC.  Updates contributions whose due_date
--            has passed and whose status is still 'pending' to is_overdue=true.
--
--   Job 2  – send_contribution_reminders
--            Runs daily at 08:00 UTC.  Fires notifications to members whose
--            contribution is due within the next 48 hours.
--
--   Job 3  – process_pending_payouts
--            Runs every hour.  Invokes the payout-process edge function to
--            initiate transfers for any payout rows in 'pending' status.
--
--   Job 4  – retry_failed_payouts
--            Runs every 6 hours.  Re-queues failed payouts (status='failed',
--            retry_count < max_retries) back to 'pending' so the hourly job
--            can pick them up.
--
--   Job 5  – cleanup_rate_limit_buckets
--            Runs daily at 02:00 UTC.  Purges expired rate-limit buckets
--            (see migration 20260314000003_rate_limiting.sql).
--
--   ⚠️  REQUIREMENT:
--     pg_cron is available on Supabase Pro and Business plans.  On the Free
--     plan you should invoke these functions from an external scheduler
--     (e.g., GitHub Actions, Vercel Cron, or an external cron service) via
--     the Supabase REST API / Edge Functions instead.
--
--   The HTTP jobs (process_pending_payouts, retry_failed_payouts) call the
--   corresponding Edge Functions using pg_net so that the full Paystack API
--   integration is reused and secrets stay server-side.
--
--   Enabling pg_net in the Supabase SQL Editor:
--     SELECT pg_net.http_post(...)  -- available without extension declaration

-- ============================================================================
-- 0. PREREQUISITES
-- ============================================================================

-- Enable pg_cron (requires superuser; run in the Supabase Dashboard → SQL Editor
-- as project owner, or via the Extensions tab)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- pg_net is pre-enabled on Supabase; ensure the schema is in the search path
-- so cron jobs can call pg_net.http_post without qualification.
SET search_path = public, pg_net;

-- ============================================================================
-- 1. JOB: mark_overdue_contributions  (daily 00:05 UTC)
-- ============================================================================

SELECT cron.schedule(
  'mark-overdue-contributions',      -- job name (unique)
  '5 0 * * *',                       -- cron expression: every day at 00:05 UTC
  $$
    SELECT mark_overdue_contributions();
  $$
);

-- ============================================================================
-- 2. JOB: send_contribution_reminders  (daily 08:00 UTC)
-- ============================================================================

-- Helper function: sends a notification to every member with a contribution
-- due within the next 2 days that has not yet been paid.
CREATE OR REPLACE FUNCTION send_contribution_reminders()
RETURNS void AS $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT
      c.id          AS contribution_id,
      c.user_id,
      c.group_id,
      c.due_date,
      g.name        AS group_name,
      g.contribution_amount
    FROM contributions c
    JOIN groups        g ON g.id = c.group_id
    WHERE c.status   = 'pending'
      AND c.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '2 days'
  LOOP
    -- Insert notification (ignore duplicate key if already sent today)
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      related_group_id
    ) VALUES (
      v_rec.user_id,
      'payment_due',
      'Contribution reminder: ' || v_rec.group_name,
      format(
        'Your contribution of ₦%s for group "%s" is due on %s. Please make your payment on time.',
        v_rec.contribution_amount::TEXT,
        v_rec.group_name,
        to_char(v_rec.due_date, 'DD Mon YYYY')
      ),
      v_rec.group_id
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT cron.schedule(
  'send-contribution-reminders',
  '0 8 * * *',                       -- every day at 08:00 UTC
  $$
    SELECT send_contribution_reminders();
  $$
);

-- ============================================================================
-- 3. JOB: process_pending_payouts  (every hour)
--    Calls the payout-process edge function via HTTP using pg_net.
-- ============================================================================

CREATE OR REPLACE FUNCTION invoke_payout_process()
RETURNS void AS $$
DECLARE
  v_supabase_url  TEXT;
  v_service_key   TEXT;
BEGIN
  -- Read config from Supabase Vault secrets (set in Dashboard → Settings → Secrets).
  -- Vault keys: supabase_url, supabase_service_role_key
  -- Fallback: use current_setting with missing_ok so this never hard-errors.
  v_supabase_url := current_setting('app.supabase_url', true);
  v_service_key  := current_setting('app.service_role_key', true);

  -- If settings are not configured, log and return gracefully.
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING '[invoke_payout_process] app.supabase_url or app.service_role_key not set — skipping HTTP call';
    RETURN;
  END IF;

  PERFORM pg_net.http_post(
    url     := v_supabase_url || '/functions/v1/payout-process',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := '{}'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT cron.schedule(
  'process-pending-payouts',
  '0 * * * *',                       -- every hour on the hour
  $$
    SELECT invoke_payout_process();
  $$
);

-- ============================================================================
-- 4. JOB: retry_failed_payouts  (every 6 hours)
--    Re-queues failed payouts that have not yet reached their retry limit
--    back to 'pending' so the hourly payout job can attempt them again.
-- ============================================================================

CREATE OR REPLACE FUNCTION requeue_failed_payouts()
RETURNS void AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE payouts
  SET    status        = 'pending',
         updated_at    = now()
  WHERE  status        = 'failed'
    AND  retry_count   < max_retries;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    RAISE NOTICE '[requeue_failed_payouts] Re-queued % payout(s) for retry', v_updated;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT cron.schedule(
  'retry-failed-payouts',
  '30 */6 * * *',                    -- every 6 hours at :30
  $$
    SELECT requeue_failed_payouts();
  $$
);

-- ============================================================================
-- 5. JOB: cleanup_rate_limit_buckets  (daily 02:00 UTC)
-- ============================================================================

SELECT cron.schedule(
  'cleanup-rate-limit-buckets',
  '0 2 * * *',                       -- every day at 02:00 UTC
  $$
    SELECT cleanup_rate_limit_buckets();
  $$
);

-- ============================================================================
-- 6. GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION send_contribution_reminders()  TO authenticated;
GRANT EXECUTE ON FUNCTION invoke_payout_process()        TO authenticated;
GRANT EXECUTE ON FUNCTION requeue_failed_payouts()       TO authenticated;
