-- ============================================================================
-- MIGRATION: Fix resource_id column type in audit_logs table
-- ============================================================================
-- This migration fixes the resource_id column type if it was created as TEXT
-- instead of UUID. Run this ONLY if you're getting the error:
-- "column 'resource_id' is of type uuid but expression is of type text"
-- ============================================================================

DO $$
BEGIN
  -- Check if resource_id is currently TEXT type
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'resource_id'
      AND (data_type = 'text' OR data_type = 'character varying')
  ) THEN
    -- Convert existing TEXT values to UUID (preserving data if valid UUIDs)
    -- This will fail if any existing values are not valid UUIDs
    ALTER TABLE audit_logs 
    ALTER COLUMN resource_id TYPE UUID USING resource_id::uuid;
    
    -- Recreate the index
    DROP INDEX IF EXISTS idx_audit_logs_resource;
    CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
    
    RAISE NOTICE 'Successfully converted resource_id from TEXT to UUID';
  ELSE
    RAISE NOTICE 'resource_id is already UUID type or column does not exist';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After running this migration, verify the column type:
SELECT 
  table_name,
  column_name,
  data_type,
  udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'audit_logs'
  AND column_name = 'resource_id';
-- Should show data_type = 'uuid'
-- ============================================================================
