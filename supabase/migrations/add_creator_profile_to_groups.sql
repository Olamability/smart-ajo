-- ============================================================================
-- Migration: Add Creator Profile Information to Groups
-- ============================================================================
-- This migration adds creator's profile image and phone number to the groups
-- table to display creator information on group cards and detail pages.
-- ============================================================================

-- Add creator profile fields to groups table
ALTER TABLE groups
ADD COLUMN IF NOT EXISTS creator_profile_image TEXT,
ADD COLUMN IF NOT EXISTS creator_phone VARCHAR(20);

-- Create index for faster lookups when filtering by phone
CREATE INDEX IF NOT EXISTS idx_groups_creator_phone ON groups(creator_phone);

-- Backfill existing groups with creator profile information
UPDATE groups
SET 
  creator_profile_image = users.avatar_url,
  creator_phone = users.phone
FROM users
WHERE groups.created_by = users.id
  AND (groups.creator_profile_image IS NULL OR groups.creator_phone IS NULL);

-- Add comment to document the fields
COMMENT ON COLUMN groups.creator_profile_image IS 'Profile image URL of the group creator, copied at group creation time';
COMMENT ON COLUMN groups.creator_phone IS 'Phone number of the group creator, copied at group creation time for display purposes';
