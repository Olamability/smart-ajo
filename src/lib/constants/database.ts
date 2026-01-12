// Database-related constants

// PostgreSQL error codes
export const POSTGRES_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
} as const;

// Default service fee percentage for groups
export const DEFAULT_SERVICE_FEE_PERCENTAGE = 2;

// KYC Status conversion
export type DbKycStatus = 'not_started' | 'pending' | 'approved' | 'rejected';
export type AppKycStatus = 'not_started' | 'pending' | 'verified' | 'rejected';

/**
 * Convert database kyc_status to application kycStatus
 * Database uses 'approved' but application uses 'verified'
 * 
 * @param dbStatus - Status from database
 * @returns Application status value
 * @throws Error if status is invalid (though this should never happen with proper DB constraints)
 */
export function convertKycStatus(dbStatus: DbKycStatus): AppKycStatus {
  if (dbStatus === 'approved') return 'verified';
  
  // Validate that we got a valid status
  const validStatuses: DbKycStatus[] = ['not_started', 'pending', 'approved', 'rejected'];
  if (!validStatuses.includes(dbStatus)) {
    console.error('Invalid KYC status from database:', dbStatus);
    // Return a safe default rather than throwing
    return 'not_started';
  }
  
  return dbStatus as AppKycStatus;
}
