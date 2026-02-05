import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from 'react';
import { createClient } from '@/lib/client/supabase';
import type { Session } from '@supabase/supabase-js';
import { User } from '@/types';
import { convertKycStatus } from '@/lib/constants/database';
import { reportError } from '@/lib/utils/errorTracking';
import { retryWithBackoff } from '@/lib/utils';
import { parseAtomicRPCResponse, isTransientError, calculateBackoffDelay } from '@/lib/utils/auth';

// Delay to allow database triggers and RLS policies to propagate after profile creation
// Increased from 500ms to 1000ms to ensure better RLS policy propagation
const PROFILE_CREATION_DELAY_MS = 1000;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signUp: (data: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Helper function to create user profile via atomic RPC function
 * Includes retry logic to handle transient network errors
 */
async function createUserProfileViaRPC(
  authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }
): Promise<void> {
  const supabase = createClient();

  const userEmail = authUser.email?.trim();
  if (!userEmail || !userEmail.includes('@')) {
    throw new Error('Valid user email is required for profile creation');
  }

  const fullName = (
    (typeof authUser.user_metadata?.full_name === 'string'
      ? authUser.user_metadata.full_name
      : null) ||
    userEmail.split('@')[0] ||
    'User'
  )
    .trim()
    .substring(0, 255);

  const phone = (
    (typeof authUser.user_metadata?.phone === 'string'
      ? authUser.user_metadata.phone
      : null) ||
    `temp_${authUser.id.substring(0, 12)}`
  )
    .trim()
    .substring(0, 20);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(authUser.id)) {
    throw new Error('Invalid user ID format');
  }

  console.log('createUserProfileViaRPC: Calling RPC with params:', {
    userId: authUser.id,
    email: userEmail,
    phone: phone,
    fullName: fullName
  });

  // Retry RPC call with exponential backoff to handle transient network errors
  const rpcResponse = await retryWithBackoff(
    async () => {
      const response = await supabase.rpc('create_user_profile_atomic', {
        p_user_id: authUser.id,
        p_email: userEmail,
        p_phone: phone,
        p_full_name: fullName,
      });
      
      // Check for transient errors that should be retried
      if (response.error) {
        if (isTransientError(response.error)) {
          throw response.error;
        }
        // Non-transient errors should fail immediately
        const error: Error & { stopRetry?: boolean } = new Error(response.error.message);
        error.stopRetry = true;
        throw error;
      }
      
      return response;
    },
    3,  // Max 3 attempts
    100,  // 100ms base delay
    (retryCount) => console.log(`createUserProfileViaRPC: Retry attempt ${retryCount} for user ${authUser.id}`)
  );

  console.log('createUserProfileViaRPC: RPC response:', rpcResponse);
  parseAtomicRPCResponse(rpcResponse, 'User profile creation');
  console.log('createUserProfileViaRPC: Profile created successfully');
}

/**
 * Helper function to check if a user with given email or phone already exists
 */
async function checkUserExists(email: string, phone: string): Promise<{
  emailExists: boolean;
  phoneExists: boolean;
  userId: string | null;
}> {
  const supabase = createClient();
  console.log('checkUserExists: Checking for existing user with email/phone');

  const { data, error } = await supabase.rpc('check_user_exists', {
    p_email: email,
    p_phone: phone,
  });

  if (error) {
    console.error('checkUserExists: Error checking user existence:', error);
    const errorCode = (error as { code?: string }).code || '';
    const errorMessage = error.message || '';
    
    // Check for critical network/connection errors that should fail signup
    const isCriticalError =
      errorCode === 'PGRST301' ||
      errorCode === '08000' ||
      errorMessage.includes('network') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('fetch');

    if (isCriticalError) {
      console.error('checkUserExists: Critical error detected, failing signup');
      throw new Error('Unable to verify account availability. Please check your connection and try again.');
    }

    // For non-critical errors (e.g., function not found), log and allow signup
    // This prevents blocking signups due to database configuration issues
    console.warn('checkUserExists: Non-critical error, allowing signup to proceed (database may handle duplicates)');
    return { emailExists: false, phoneExists: false, userId: null };
  }

  const result = Array.isArray(data) && data.length > 0 ? data[0] : data;

  console.log('checkUserExists: Result:', result);

  return {
    emailExists: result?.email_exists || false,
    phoneExists: result?.phone_exists || false,
    userId: result?.user_id || null,
  };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const isLoadingProfileRef = useRef(false);
  const userRef = useRef<User | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const loadUserProfile = async (
    userId: string, 
    force: boolean = false,
    existingSession?: Session | null
  ): Promise<boolean> => {
    if (!force && isLoadingProfileRef.current) return false;
    if (!force && userRef.current?.id === userId) return true;

    try {
      isLoadingProfileRef.current = true;
      console.log(`loadUserProfile: Loading profile for user: ${userId}${force ? ' (forced)' : ''}${existingSession ? ' (using provided session)' : ''}`);
      
      // Validate session (either provided or fetched)
      let session: Session | null = null;
      
      // If we have an existing session passed in, use it directly (e.g., from login)
      // This avoids race conditions where getSession() might not immediately reflect the new session
      if (existingSession) {
        if (existingSession.user.id !== userId) {
          throw new Error('Session user mismatch');
        }
        session = existingSession;
        console.log('loadUserProfile: Using provided session, skipping session verification');
      } else {
        // Only verify session if one wasn't provided
        // Retry session check with backoff - session might be restoring after redirect
        for (let sessionAttempts = 0; sessionAttempts < 5; sessionAttempts++) {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError) {
            console.error('loadUserProfile: Session error:', sessionError);
            // If there's a session error, wait and retry
            if (sessionAttempts < 4) {
              const delay = calculateBackoffDelay(sessionAttempts);
              console.log(`loadUserProfile: Retrying session check in ${delay}ms (attempt ${sessionAttempts + 1}/5)`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            throw new Error('Unable to verify session. Please try logging in again.');
          }
          
          if (sessionData.session) {
            session = sessionData.session;
            break;
          }
          
          // No session yet, wait and retry
          if (sessionAttempts < 4) {
            const delay = calculateBackoffDelay(sessionAttempts);
            console.log(`loadUserProfile: Session not ready, retrying in ${delay}ms (attempt ${sessionAttempts + 1}/5)`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw new Error('Session expired or not found. Please log in again.');
          }
        }
        
        if (!session) {
          throw new Error('Session expired or not found. Please log in again.');
        }
        
        if (session.user.id !== userId) {
          throw new Error('Session user mismatch');
        }
      }

      const result = await retryWithBackoff(
        async () => {
          const queryResult = await supabase.from('users').select('*').eq('id', userId).single();
          if (queryResult.error) {
            if (isTransientError(queryResult.error)) throw queryResult.error;
            const error: Error & { stopRetry?: boolean } = new Error(`Failed to load user profile: ${queryResult.error.message}`);
            error.stopRetry = true;
            throw error;
          }
          if (!queryResult.data) {
            const error: Error & { code?: string } = new Error('User profile not found');
            error.code = 'PGRST301';
            throw error;
          }
          return queryResult.data;
        },
        3,
        100,
        (retryCount) => console.log(`loadUserProfile: Retry attempt ${retryCount} for user ${userId}`)
      );

      console.log('loadUserProfile: Profile loaded successfully');
      setUser({
        id: result.id,
        email: result.email,
        phone: result.phone,
        fullName: result.full_name,
        createdAt: result.created_at,
        isVerified: result.is_verified,
        isAdmin: result.is_admin || false,
        kycStatus: convertKycStatus(result.kyc_status),
        bvn: result.kyc_data?.bvn,
        profileImage: result.avatar_url,
        dateOfBirth: result.date_of_birth ?? undefined,
        address: result.address ?? undefined,
        isActive: result.is_active ?? true,
        updatedAt: result.updated_at ?? undefined,
        lastLoginAt: result.last_login_at ?? undefined,
        bankName: result.bank_name ?? undefined,
        accountNumber: result.account_number ?? undefined,
        accountName: result.account_name ?? undefined,
        bankCode: result.bank_code ?? undefined,
      });

      return true;
    } catch (error) {
      console.error('loadUserProfile: Error loading profile:', error);
      setUser(null);
      throw error;
    } finally {
      isLoadingProfileRef.current = false;
    }
  };

  const refreshUser = async (): Promise<boolean> => {
    try {
      console.log('refreshUser: Starting user refresh');
      
      // Retry session check with backoff to handle post-redirect session restoration
      let session = null;
      
      for (let sessionAttempts = 0; sessionAttempts < 5; sessionAttempts++) {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('refreshUser: Session error:', error);
          if (sessionAttempts < 4) {
            const delay = calculateBackoffDelay(sessionAttempts);
            console.log(`refreshUser: Retrying session check in ${delay}ms (attempt ${sessionAttempts + 1}/5)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          setUser(null);
          return false;
        }
        
        if (data.session) {
          session = data.session;
          break;
        }
        
        // No session yet, wait and retry
        if (sessionAttempts < 4) {
          const delay = calculateBackoffDelay(sessionAttempts);
          console.log(`refreshUser: Session not ready, retrying in ${delay}ms (attempt ${sessionAttempts + 1}/5)`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.log('refreshUser: No active session found after retries');
          setUser(null);
          return false;
        }
      }
      
      if (!session?.user) {
        console.log('refreshUser: No active session found');
        setUser(null);
        return false;
      }

      console.log('refreshUser: Active session found, loading profile');
      try {
        await loadUserProfile(session.user.id, true);
        console.log('refreshUser: Profile loaded successfully');
        return true;
      } catch (profileError) {
        console.error('refreshUser: Failed to load profile:', profileError);
        try {
          console.log('refreshUser: Attempting to create missing profile');
          await createUserProfileViaRPC(session.user);
          await new Promise(resolve => setTimeout(resolve, PROFILE_CREATION_DELAY_MS));
          await loadUserProfile(session.user.id, true);
          console.log('refreshUser: Profile created and loaded successfully');
          return true;
        } catch (createError) {
          console.error('refreshUser: Failed to create profile:', createError);
          setUser(null);
          return false;
        }
      }
    } catch (error) {
      console.error('refreshUser: Unexpected error:', error);
      setUser(null);
      return false;
    }
  };

  const login = async (email: string, password: string) => {
    try {
      console.log('login: Starting login for:', email);

      const { error, data } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error('login: Auth error:', error.message);
        // Re-throw auth errors with full context for UI error mapping
        throw error;
      }

      if (!data?.user || !data.session) {
        throw new Error('Login failed: No user data returned');
      }

      console.log('login: Auth successful, loading user profile...');
      
      // ✅ Pass the session from signInWithPassword directly to avoid race condition
      // This prevents loadUserProfile from calling getSession() which may not be ready yet
      try {
        await loadUserProfile(data.user.id, true, data.session);
        console.log('login: Profile loaded successfully, login complete');
      } catch (profileError) {
        console.error('login: Failed to load profile, attempting to create:', profileError);
        
        // If profile doesn't exist, try to create it
        // This handles users who signed up but didn't complete email confirmation
        try {
          await createUserProfileViaRPC(data.user);
          await new Promise(resolve => setTimeout(resolve, PROFILE_CREATION_DELAY_MS));
          // Still pass the session to avoid race condition on retry
          await loadUserProfile(data.user.id, true, data.session);
          console.log('login: Profile created and loaded successfully');
        } catch (createError) {
          console.error('login: Failed to create/load profile:', createError);
          // Clean up by signing out if we can't load/create profile
          await supabase.auth.signOut();
          const errorMsg = createError instanceof Error ? createError.message : 'Unknown error';
          throw new Error(`Failed to load user profile: ${errorMsg}. Please try again or contact support if the issue persists.`);
        }
      }
    } catch (error) {
      console.error('login: Login failed:', error);
      reportError(error, { operation: 'login', email: email });
      throw error;
    }
  };

  const signUp = async ({
    email,
    password,
    fullName,
    phone,
  }: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
  }) => {
    try {
      console.log('signUp: Starting signup for:', email);
      const trimmedEmail = email.trim().toLowerCase();
      const trimmedFullName = fullName.trim();
      const trimmedPhone = phone.trim();

      if (!trimmedEmail || !trimmedEmail.includes('@')) throw new Error('Please provide a valid email address');
      if (trimmedFullName.length < 2) throw new Error('Full name must be at least 2 characters');
      if (trimmedPhone.length < 10) throw new Error('Phone number must be at least 10 characters');
      if (password.length < 6) throw new Error('Password must be at least 6 characters');

      console.log('signUp: Checking if user already exists...');
      const existingUser = await checkUserExists(trimmedEmail, trimmedPhone);

      if (existingUser.emailExists && existingUser.phoneExists) throw new Error('An account with this email and phone number already exists. Please sign in instead.');
      else if (existingUser.emailExists) throw new Error('An account with this email already exists. Please sign in or use a different email.');
      else if (existingUser.phoneExists) throw new Error('An account with this phone number already exists. Please sign in or use a different phone number.');

      console.log('signUp: No existing user found, proceeding with signup');

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: { data: { full_name: trimmedFullName, phone: trimmedPhone } },
      });

      if (error || !data.user) {
        console.error('Signup auth error:', error?.message);
        if (error?.message?.includes('User already registered')) throw new Error('This email is already registered. Please sign in instead.');
        throw error || new Error('Signup failed: No user data returned');
      }

      const needsEmailConfirmation = data.user && !data.session;

      console.log('Signup successful:', {
        userId: data.user.id,
        email: data.user.email,
        needsEmailConfirmation,
      });

      // ✅ NEW APPROACH: Don't create profile during signup
      // Profile creation will happen during first login after email confirmation
      // This prevents issues with unconfirmed accounts and simplifies the flow
      
      if (needsEmailConfirmation) {
        console.log('signUp: Email confirmation required - profile will be created after user confirms and logs in');
        // Throw a special marker error that the UI can catch
        throw new Error('CONFIRMATION_REQUIRED');
      }

      // If no email confirmation required (instant login), create profile and load it
      console.log('signUp: No email confirmation required, creating profile...');
      try {
        await createUserProfileViaRPC(data.user);
        console.log('signUp: User profile created successfully');
        await new Promise(resolve => setTimeout(resolve, PROFILE_CREATION_DELAY_MS));
        
        // Load profile with the session from signup
        if (data.session) {
          await loadUserProfile(data.user.id, true, data.session);
          console.log('signUp: Profile loaded, signup complete');
        }
      } catch (profileCreationError) {
        console.error('signUp: Failed to create user profile:', profileCreationError);
        try {
          await supabase.auth.signOut();
        } catch (signOutError) {
          console.error('Failed to sign out after profile creation error:', signOutError);
        }
        setUser(null);
        isLoadingProfileRef.current = false;
        throw profileCreationError;
      }
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    }
  };

  const logout = async () => {
    console.log('logout: Starting logout process');
    try {
      setUser(null);
      isLoadingProfileRef.current = false;
      await supabase.auth.signOut();
      console.log('logout: Successfully signed out');
    } catch (error) {
      console.error('logout: Error during logout:', error);
      setUser(null);
      isLoadingProfileRef.current = false;
    }
  };

  useEffect(() => {
    let mounted = true;
    let initCompleted = false;

    const initAuth = async () => {
      try {
        console.log('Initializing auth context...');
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && mounted) {
          console.log('Found existing session, loading user profile...');
          try {
            await loadUserProfile(session.user.id);
          } catch (_error) {
            try {
              await createUserProfileViaRPC(session.user);
              await new Promise(resolve => setTimeout(resolve, PROFILE_CREATION_DELAY_MS));
              await loadUserProfile(session.user.id, true);
            } catch (createError) {
              console.error('Failed to create profile during init:', createError);
              await supabase.auth.signOut();
            }
          }
        }
      } catch (error) {
        console.error('Error during auth initialization:', error);
      } finally {
        // ✅ FIX: Mark initialization as complete before checking mounted state
        // This prevents race conditions where component unmounts during initialization
        initCompleted = true;
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!initCompleted && event === 'SIGNED_IN') return;
      console.log('Auth state change event:', event, 'User ID:', session?.user?.id);

      if (event === 'SIGNED_OUT') {
        isLoadingProfileRef.current = false;
        setUser(null);
      }

      if (event === 'SIGNED_IN' && session?.user) {
        try {
          await loadUserProfile(session.user.id);
        } catch (_error) {
          try {
            await createUserProfileViaRPC(session.user);
            await new Promise(resolve => setTimeout(resolve, PROFILE_CREATION_DELAY_MS));
            await loadUserProfile(session.user.id, true);
          } catch (createError) {
            console.error('Failed to create profile on auth state change:', createError);
            await supabase.auth.signOut();
          }
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, isAuthenticated: !!user, login, signUp, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
