-- ============================================================================
-- Migration: Add Bank Account Fields to Users Table
-- ============================================================================
-- This migration adds bank account fields to the users table to enable
-- automated payouts to group members.
-- 
-- Fields added:
-- - bank_name: Name of the bank
-- - account_number: 10-digit account number
-- - account_name: Name on the bank account (for verification)
-- - bank_code: Bank code for API integration (e.g., Paystack)
-- ============================================================================

-- Add bank account fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS account_number VARCHAR(10),
ADD COLUMN IF NOT EXISTS account_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS bank_code VARCHAR(10);

-- Add index for account verification lookups
CREATE INDEX IF NOT EXISTS idx_users_account_number ON users(account_number) WHERE account_number IS NOT NULL;

-- Add comment to document the purpose of these fields
COMMENT ON COLUMN users.bank_name IS 'Name of the user''s bank (e.g., GTBank, Access Bank)';
COMMENT ON COLUMN users.account_number IS '10-digit bank account number for receiving payouts';
COMMENT ON COLUMN users.account_name IS 'Name on the bank account for verification';
COMMENT ON COLUMN users.bank_code IS 'Bank code for payment gateway integration';

-- Create a function to validate bank account number format (must be 10 digits)
CREATE OR REPLACE FUNCTION validate_account_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_number IS NOT NULL THEN
    -- Check if account number is exactly 10 digits
    IF NEW.account_number !~ '^[0-9]{10}$' THEN
      RAISE EXCEPTION 'Account number must be exactly 10 digits';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to validate account number on insert/update
DROP TRIGGER IF EXISTS validate_account_number_trigger ON users;
CREATE TRIGGER validate_account_number_trigger
  BEFORE INSERT OR UPDATE OF account_number ON users
  FOR EACH ROW
  EXECUTE FUNCTION validate_account_number();
