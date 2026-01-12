-- ============================================================================
-- SECURED-AJO STORAGE SCHEMA
-- ============================================================================
-- This file defines the Supabase Storage configuration for the Secured-Ajo
-- platform including buckets and storage policies.
--
-- BUCKETS:
-- - avatars: User profile pictures
-- - kyc-documents: KYC verification documents (ID cards, etc.)
-- - group-images: Group profile/cover images
--
-- IMPORTANT: Storage buckets must be created through the Supabase dashboard
-- or using the Supabase CLI. This file documents the configuration.
-- ============================================================================

-- ============================================================================
-- BUCKET: avatars
-- ============================================================================
-- Purpose: Store user profile pictures
-- Access: Public read, authenticated users can upload their own
-- Max file size: 2MB
-- Allowed MIME types: image/jpeg, image/png, image/webp, image/gif
-- ============================================================================

-- Storage Policy: Allow authenticated users to upload their own avatar
CREATE POLICY "Users can upload their own avatar" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage Policy: Allow users to update their own avatar
CREATE POLICY "Users can update their own avatar" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'avatars' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage Policy: Allow users to delete their own avatar
CREATE POLICY "Users can delete their own avatar" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'avatars' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage Policy: Anyone can view avatars (public read)
CREATE POLICY "Anyone can view avatars" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

-- ============================================================================
-- BUCKET: kyc-documents
-- ============================================================================
-- Purpose: Store KYC verification documents
-- Access: Private - only the owner and service role can access
-- Max file size: 5MB
-- Allowed MIME types: image/jpeg, image/png, application/pdf
-- ============================================================================

-- Storage Policy: Users can upload their own KYC documents
CREATE POLICY "Users can upload their own KYC documents" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'kyc-documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage Policy: Users can view their own KYC documents
CREATE POLICY "Users can view their own KYC documents" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'kyc-documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage Policy: Users can delete their own KYC documents
CREATE POLICY "Users can delete their own KYC documents" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'kyc-documents' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Note: Service role bypasses RLS and can access all documents

-- ============================================================================
-- BUCKET: group-images
-- ============================================================================
-- Purpose: Store group profile and cover images
-- Access: Public read, group creators/members can upload
-- Max file size: 3MB
-- Allowed MIME types: image/jpeg, image/png, image/webp
-- ============================================================================

-- Storage Policy: Group members can upload group images
CREATE POLICY "Group members can upload group images" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'group-images' 
    AND EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id::text = (storage.foldername(name))[1]
        AND gm.user_id = auth.uid()
        AND gm.status = 'active'
    )
  );

-- Storage Policy: Anyone can view group images
CREATE POLICY "Anyone can view group images" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'group-images');

-- Storage Policy: Group creators can delete group images
CREATE POLICY "Group creators can delete group images" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'group-images' 
    AND EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id::text = (storage.foldername(name))[1]
        AND g.created_by = auth.uid()
    )
  );

-- ============================================================================
-- SETUP INSTRUCTIONS FOR STORAGE
-- ============================================================================
--
-- MANUAL SETUP (Supabase Dashboard):
-- 1. Go to Storage in your Supabase dashboard
-- 2. Create the following buckets:
--
-- Bucket: avatars
-- - Public: Yes (enable public access)
-- - File size limit: 2MB
-- - Allowed MIME types: image/jpeg, image/png, image/webp, image/gif
--
-- Bucket: kyc-documents
-- - Public: No (private bucket)
-- - File size limit: 5MB
-- - Allowed MIME types: image/jpeg, image/png, application/pdf
--
-- Bucket: group-images
-- - Public: Yes (enable public access)
-- - File size limit: 3MB
-- - Allowed MIME types: image/jpeg, image/png, image/webp
--
-- 3. After creating buckets, run this SQL file in the SQL Editor to create policies
--
-- ALTERNATIVE: Using Supabase CLI
-- supabase storage create avatars --public
-- supabase storage create kyc-documents
-- supabase storage create group-images --public
--
-- Then run: supabase db push storage.sql
--
-- ============================================================================
-- FILE NAMING CONVENTION
-- ============================================================================
--
-- avatars/
--   {user_id}/
--     avatar.{ext}              # Current avatar
--     avatar-{timestamp}.{ext}  # Historical avatars (optional)
--
-- kyc-documents/
--   {user_id}/
--     id-front.{ext}           # Front of ID card
--     id-back.{ext}            # Back of ID card
--     selfie.{ext}             # Selfie for verification
--     proof-of-address.{ext}   # Utility bill, etc.
--
-- group-images/
--   {group_id}/
--     profile.{ext}            # Group profile image
--     cover.{ext}              # Group cover image
--
-- ============================================================================
-- HELPER FUNCTIONS FOR STORAGE
-- ============================================================================

-- Function to get avatar URL for a user
CREATE OR REPLACE FUNCTION get_avatar_url(user_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT 
      CASE 
        WHEN EXISTS (
          SELECT 1 FROM storage.objects 
          WHERE bucket_id = 'avatars' 
            AND name LIKE user_id::text || '/%'
        )
        THEN (
          SELECT concat(
            current_setting('app.settings.supabase_url', true),
            '/storage/v1/object/public/avatars/',
            name
          )
          FROM storage.objects
          WHERE bucket_id = 'avatars'
            AND name LIKE user_id::text || '/%'
          ORDER BY created_at DESC
          LIMIT 1
        )
        ELSE NULL
      END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STORAGE USAGE QUERIES
-- ============================================================================

-- Get storage usage by bucket
-- SELECT 
--   bucket_id,
--   COUNT(*) as file_count,
--   pg_size_pretty(SUM(metadata->>'size')::bigint) as total_size
-- FROM storage.objects
-- GROUP BY bucket_id;

-- Get user's KYC document status
-- SELECT 
--   name,
--   created_at,
--   metadata->>'size' as size,
--   metadata->>'mimetype' as type
-- FROM storage.objects
-- WHERE bucket_id = 'kyc-documents'
--   AND name LIKE '{user_id}/%'
-- ORDER BY created_at DESC;

-- ============================================================================
