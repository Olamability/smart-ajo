/**
 * API Layer for Smart Ajo Platform
 * 
 * This directory contains utilities and functions for interacting with Supabase backend.
 * All server-side logic is handled by Supabase (Auth, Database, Storage, Edge Functions).
 * 
 * Note: This is NOT a traditional REST API server. All API calls go through Supabase client.
 */

// Re-export API services for easy imports
export * from './groups';
export * from './contributions';
export * from './transactions';
export * from './notifications';
export * from './stats';
export * from './profile';
export * from './payments';
