-- ============================================================
-- Rate Limiting
--
-- Provides a lightweight, database-backed rate limiter for use
-- inside Supabase Edge Functions (auth endpoints, payment APIs).
--
-- Usage (from an Edge Function, via service-role client):
--   SELECT check_rate_limit('user:<uuid>', 'payment_init', 10, 60);
--   -- returns TRUE  → request allowed
--   -- returns FALSE → limit exceeded, reject the request
-- ============================================================

-- Table that tracks the sliding window of requests per key
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id          BIGSERIAL PRIMARY KEY,
  bucket_key  TEXT        NOT NULL,  -- e.g. "user:<uuid>:payment_init"
  window_end  TIMESTAMPTZ NOT NULL,  -- when this window expires
  hit_count   INTEGER     NOT NULL DEFAULT 1,
  CONSTRAINT unique_rate_bucket UNIQUE (bucket_key, window_end)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_key_window
  ON rate_limit_buckets (bucket_key, window_end);

-- Auto-clean expired buckets so the table stays small
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_end
  ON rate_limit_buckets (window_end);

-- ============================================================
-- check_rate_limit(key, action, max_requests, window_seconds)
--
-- Atomically increments the counter for (key, action) inside
-- the current window. Returns TRUE when the request is within
-- the allowed limit, FALSE when the limit is exceeded.
-- ============================================================
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_identifier   TEXT,    -- typically 'user:<uuid>' or 'ip:<addr>'
  p_action       TEXT,    -- e.g. 'payment_init', 'auth_attempt'
  p_max_requests INTEGER, -- allowed requests per window
  p_window_secs  INTEGER  -- window length in seconds
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bucket_key  TEXT;
  v_window_start TIMESTAMPTZ;
  v_hits         INTEGER;
BEGIN
  v_bucket_key  := p_identifier || ':' || p_action;
  -- Align to a fixed grid so all callers in the same window share the same bucket
  v_window_start := to_timestamp(
    floor(EXTRACT(EPOCH FROM NOW()) / p_window_secs) * p_window_secs
  );

  INSERT INTO rate_limit_buckets (bucket_key, window_end, hit_count)
  VALUES (v_bucket_key, v_window_start + (p_window_secs * INTERVAL '1 second'), 1)
  ON CONFLICT (bucket_key, window_end)
  DO UPDATE SET hit_count = rate_limit_buckets.hit_count + 1
  RETURNING hit_count INTO v_hits;

  RETURN v_hits <= p_max_requests;
END;
$$;

-- Row Level Security: only service-role (Edge Functions) may touch this table
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- No authenticated-user policy intentionally – only service-role bypasses RLS
-- Edge Functions use the service-role key and therefore bypass RLS automatically.

-- ============================================================
-- purge_expired_rate_limit_buckets()
--
-- Removes expired buckets. Call this from a scheduled job
-- (pg_cron or GitHub Actions) to keep the table small.
-- ============================================================
CREATE OR REPLACE FUNCTION purge_expired_rate_limit_buckets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM rate_limit_buckets WHERE window_end < NOW() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
