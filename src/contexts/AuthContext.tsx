import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from 'react';
import { createClient } from '@/lib/client/supabase';
import { User } from '@/types';
import { convertKycStatus } from '@/lib/constants/database';
import { reportError } from '@/lib/utils/errorTracking';
import { retryWithBackoff } from '@/lib/utils';
import { parseAtomicRPCResponse, isTransientError } from '@/lib/utils/auth';

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
 * Single source of truth for profile creation
 * Includes input validation and sanitization
 */
async function createUserProfileViaRPC(
  authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }
): Promise<void> {
  const supabase = createClient();
  
  const userEmail = authUser.email?.trim();
  if (!userEmail || !userEmail.includes('@')) {
    throw new Error('Valid user email is required for profile creation');
  }
  
  // Sanitize and validate inputs
  const fullName = (
    (typeof authUser.user_metadata?.full_name === 'string' 
      ? authUser.user_metadata.full_name 
      : null) || 
    userEmail.split('@')[0] || 
    'User'
  )
    .trim()
    .substring(0, 255); // Limit to 255 chars
  
  const phone = (
    (typeof authUser.user_metadata?.phone === 'string'
      ? authUser.user_metadata.phone
      : null) ||
    `temp_${authUser.id.substring(0, 12)}`
  )
    .trim()
    .substring(0, 20); // Limit to 20 chars
  
  // Validate UUID format
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
  
  const rpcResponse = await supabase.rpc('create_user_profile_atomic', {
    p_user_id: authUser.id,
    p_email: userEmail,
    p_phone: phone,
    p_full_name: fullName,
  });
  
  console.log('createUserProfileViaRPC: RPC response:', rpcResponse);
  
  parseAtomicRPCResponse(rpcResponse, 'User profile creation');
  console.log('createUserProfileViaRPC: Profile created successfully');
}

/**
 * Helper function to check if a user with given email or phone already exists
 * Returns conflict information to help with validation
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
    
    // For critical errors (network, timeout), we should throw to prevent bad UX
    // For other errors, allow signup to proceed and handle at profile creation
    // Check both error codes and messages for better coverage
    const errorCode = (error as { code?: string }).code || '';
    const errorMessage = error.message || '';
    
    const isCriticalError = 
      errorCode === 'PGRST301' || // PostgREST network error
      errorCode === '08000' ||    // PostgreSQL connection error
      errorMessage.includes('network') || 
      errorMessage.includes('timeout') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('fetch');
    
    if (isCriticalError) {
      console.error('checkUserExists: Critical error detected, rethrowing');
      throw new Error('Network error. Please check your connection and try again.');
    }
    
    // Non-critical error: allow signup to proceed
    console.log('checkUserExists: Non-critical error, allowing signup to proceed');
    return { emailExists: false, phoneExists: false, userId: null };
  }
  
  // The RPC function is defined to return TABLE(...) which Supabase returns as an array of rows
  // Even for single-row results, it's wrapped in an array: [{ email_exists: true, ... }]
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
  const isLoadingProfileRef = useRef(false); // Prevent concurrent profile loads
  const userRef = useRef<User | null>(null); // Track current user for login promise

  // Keep userRef in sync with user state
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  /**
   * Load user profile from DB
   * Uses exponential backoff for transient errors (network, RLS propagation)
   * Immediately fails for non-transient errors
   * Prevents concurrent loads using a ref flag
   */
  const loadUserProfile = async (userId: string, force: boolean = false): Promise<boolean> => {
    // Prevent concurrent profile loads (unless force is true)
    if (!force && isLoadingProfileRef.current) {
      console.log(`loadUserProfile: Already loading profile, skipping duplicate request`);
      return false;
    }
    
    // If user is already loaded with the same ID, skip reload (unless force is true)
    if (!force && userRef.current?.id === userId) {
      console.log(`loadUserProfile: Profile already loaded for user ${userId}, skipping`);
      return true;
    }
    
    try {
      isLoadingProfileRef.current = true;
      console.log(`loadUserProfile: Loading profile for user: ${userId}${force ? ' (forced)' : ''}`);
      
      // Verify we have an active session (no retry, should be ready)
      const { data: sessionData } = await supabase.auth.getSession();
      
      if (!sessionData.session) {
        throw new Error('No active session. Please try logging in again.');
      }
      
      if (sessionData.session.user.id !== userId) {
        throw new Error('Session user mismatch');
      }
      
      // Query the users table with retry logic for transient errors
      const result = await retryWithBackoff(
        async () => {
          const queryResult = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

          // Check error and decide whether to retry
          if (queryResult.error) {
            // Check if this is a transient error worth retrying
            if (isTransientError(queryResult.error)) {
              // Transient error - throw it to be retried
              console.log('loadUserProfile: Transient error, will retry:', queryResult.error.message);
              throw queryResult.error;
            } else {
              // Non-transient error - throw with marker to stop retries
              console.error('loadUserProfile: Non-transient error:', queryResult.error);
              const error: Error & { stopRetry?: boolean } = new Error(`Failed to load user profile: ${queryResult.error.message}`);
              error.stopRetry = true;
              throw error;
            }
          }

          if (!queryResult.data) {
            // No data found - could be RLS issue or missing profile
            // Treat as transient for now (might be RLS propagation delay)
            console.log('loadUserProfile: No data returned, treating as transient');
            const error: Error & { code?: string } = new Error('User profile not found');
            error.code = 'PGRST301'; // Will be treated as transient
            throw error;
          }

          // Return the data directly (not wrapped in another object)
          return queryResult.data;
        },
        3, // Max 3 retries for transient errors
        100, // Start with 100ms, exponential backoff
        (retryCount) => {
          console.log(`loadUserProfile: Retry attempt ${retryCount} for user ${userId}`);
        }
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
        isActive: result.is_active ?? true, // Default to true if not set
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

  /**
   * Refresh session + user
   * Returns true if successful, false otherwise
   * Used for manual refresh operations
   */
  const refreshUser = async (): Promise<boolean> => {
    try {
      console.log('refreshUser: Starting user refresh');
      const { data, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('refreshUser: Session error:', error);
        setUser(null);
        return false;
      }
      
      const session = data.session;

      if (!session?.user) {
        console.log('refreshUser: No active session found');
        setUser(null);
        return false;
      }

      console.log('refreshUser: Active session found, loading profile');
      try {
        await loadUserProfile(session.user.id, true); // Force reload
        console.log('refreshUser: Profile loaded successfully');
        return true;
      } catch (profileError) {
        console.error('refreshUser: Failed to load profile:', profileError);
        
        // Try to create profile if it doesn't exist
        // This handles edge cases where profile wasn't created during signup
        try {
          console.log('refreshUser: Attempting to create missing profile');
          await createUserProfileViaRPC(session.user);
          await new Promise(resolve => setTimeout(resolve, 500));
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

  /**
   * LOGIN  
   * Authenticates user and waits for profile to be loaded
   * Uses a promise-based approach to wait for onAuthStateChange to complete
   */
  const login = async (email: string, password: string) => {
    try {
      console.log('login: Starting login for:', email);
      
      // Create a promise that resolves when profile is loaded
      const profileLoadedPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Profile loading timed out after 10 seconds'));
        }, 10000); // 10 second timeout
        
        // Set up a one-time listener for profile loading
        const checkInterval = setInterval(() => {
          if (userRef.current !== null) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve();
          }
        }, 100); // Check every 100ms
      });
      
      const { error, data } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('login: Auth error:', error.message);
        throw error;
      }

      if (!data?.user || !data.session) {
        throw new Error('Login failed: No user data returned');
      }

      console.log('login: Auth successful, waiting for profile to load via auth state change...');
      
      // Wait for the profile to be loaded by onAuthStateChange
      await profileLoadedPromise;
      
      console.log('login: Profile loaded, login complete');
      
    } catch (error) {
      console.error('login: Login failed:', error);
      reportError(error, {
        operation: 'login',
        email: email,
      });
      throw error;
    }
  };

  /**
   * SIGN UP
   * Creates auth user and profile, lets onAuthStateChange handle session
   * Includes proper error handling and cleanup on failure
   */
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
      
      // Validate inputs
      const trimmedEmail = email.trim().toLowerCase();
      const trimmedFullName = fullName.trim();
      const trimmedPhone = phone.trim();
      
      if (!trimmedEmail || !trimmedEmail.includes('@')) {
        throw new Error('Please provide a valid email address');
      }
      
      if (trimmedFullName.length < 2) {
        throw new Error('Full name must be at least 2 characters');
      }
      
      if (trimmedPhone.length < 10) {
        throw new Error('Phone number must be at least 10 characters');
      }
      
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }
      
      // Check if user already exists before creating auth user
      console.log('signUp: Checking if user already exists...');
      const existingUser = await checkUserExists(trimmedEmail, trimmedPhone);
      
      if (existingUser.emailExists && existingUser.phoneExists) {
        throw new Error('An account with this email and phone number already exists. Please sign in instead.');
      } else if (existingUser.emailExists) {
        throw new Error('An account with this email already exists. Please sign in or use a different email.');
      } else if (existingUser.phoneExists) {
        throw new Error('An account with this phone number already exists. Please sign in or use a different phone number.');
      }
      
      console.log('signUp: No existing user found, proceeding with signup');
      
      // Sign up with Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            full_name: trimmedFullName,
            phone: trimmedPhone,
          },
        },
      });

      if (error || !data.user) {
        console.error('Signup auth error:', error?.message);
        
        // Provide more helpful error messages for common auth errors
        if (error?.message?.includes('User already registered')) {
          throw new Error('This email is already registered. Please sign in instead.');
        }
        
        throw error || new Error('Signup failed: No user data returned');
      }

      // Check if email confirmation is required
      const needsEmailConfirmation = data.user && !data.session;
      
      console.log('Signup successful:', {
        userId: data.user.id,
        email: data.user.email,
        needsEmailConfirmation,
      });

      // Create user profile atomically - single source of truth
      try {
        console.log('signUp: Creating user profile in database');
        await createUserProfileViaRPC(data.user);
        console.log('signUp: User profile created successfully');
      } catch (profileCreationError) {
        console.error('signUp: Failed to create user profile:', profileCreationError);
        console.error('signUp: Profile creation error for user:', data.user.id);
        
        // Extract the actual error message
        const errorMessage = profileCreationError instanceof Error 
          ? profileCreationError.message 
          : 'Unknown error';
        
        // If profile creation fails, clean up the auth user
        console.log('signUp: Signing out auth user due to profile creation failure');
        try {
          await supabase.auth.signOut();
        } catch (signOutError) {
          console.error('signUp: Error signing out after profile creation failure:', signOutError);
        }
        
        // Clean up state
        setUser(null);
        isLoadingProfileRef.current = false;
        
        // Provide user-friendly error messages
        if (errorMessage.includes('Email is already registered')) {
          throw new Error('This email is already registered. Please sign in instead.');
        } else if (errorMessage.includes('Phone number is already registered')) {
          throw new Error('This phone number is already registered. Please use a different phone number.');
        } else {
          throw new Error(
            `Failed to create user profile: ${errorMessage}. Please try again or contact support if the problem persists.`
          );
        }
      }

      // If email confirmation is required, don't try to load profile yet
      if (needsEmailConfirmation) {
        console.log('Email confirmation required - profile will be loaded after confirmation');
        throw new Error('CONFIRMATION_REQUIRED:Please check your email to confirm your account before signing in.');
      }

      // If we have an active session, profile loading will be handled by onAuthStateChange
      // Don't load it here to avoid race conditions
      console.log('signUp: Signup complete. Session established, profile loading will be handled by auth state change event.');
      
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    }
  };

  /**
   * LOGOUT
   * Clears all session data and user state
   */
  const logout = async () => {
    console.log('logout: Starting logout process');
    try {
      // Clear user state first to prevent any ongoing operations
      setUser(null);
      
      // Reset loading flag to allow fresh login
      isLoadingProfileRef.current = false;
      
      // Sign out from Supabase (clears cookies, local storage, etc.)
      await supabase.auth.signOut();
      
      console.log('logout: Successfully signed out');
    } catch (error) {
      console.error('logout: Error during logout:', error);
      // Even if signOut fails, ensure user state is cleared
      setUser(null);
      isLoadingProfileRef.current = false;
    }
  };

  /**
   * INIT
   * Initialize authentication state on mount
   * Checks for existing session and loads user profile if found
   */
  useEffect(() => {
    let mounted = true;
    let initCompleted = false;

    const initAuth = async () => {
      try {
        console.log('Initializing auth context...');
        
        // Check if there's an active session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user && mounted) {
          console.log('Found existing session, loading user profile...');
          try {
            await loadUserProfile(session.user.id);
            console.log('Auth initialization complete, user authenticated');
          } catch (error) {
            console.error('Error loading profile during init:', error);
            // Try to create the profile if it doesn't exist
            try {
              console.log('Attempting to create missing profile during init...');
              await createUserProfileViaRPC(session.user);
              await new Promise(resolve => setTimeout(resolve, 500));
              await loadUserProfile(session.user.id, true);
              console.log('Profile created and loaded successfully during init');
            } catch (createError) {
              console.error('Failed to create profile during init:', createError);
              // Clear the broken session
              await supabase.auth.signOut();
            }
          }
        } else {
          console.log('No existing session found');
        }
        
        initCompleted = true;
      } catch (error) {
        console.error('Error during auth initialization:', error);
      } finally {
        if (mounted) {
          setLoading(false);
          console.log('Auth loading state set to false');
        }
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Skip handling SIGNED_IN during initialization to avoid race conditions
      if (!initCompleted && event === 'SIGNED_IN') {
        console.log('Auth state change (SIGNED_IN) during init, skipping to avoid race condition');
        return;
      }
      
      console.log('Auth state change event:', event, 'User ID:', session?.user?.id);
      
      if (event === 'SIGNED_OUT') {
        console.log('User signed out, clearing user state and loading flag');
        isLoadingProfileRef.current = false; // Reset loading flag on logout
        setUser(null);
      }

      if (event === 'SIGNED_IN' && session?.user) {
        console.log('User signed in via auth state change, loading profile');
        try {
          await loadUserProfile(session.user.id);
          console.log('Profile loaded successfully via auth state change');
        } catch (error) {
          console.error('Error loading profile on auth state change:', error);
          
          // Try to create the profile if it doesn't exist
          try {
            console.log('Attempting to create missing profile...');
            await createUserProfileViaRPC(session.user);
            // Wait a bit for profile to be created and RLS to propagate
            await new Promise(resolve => setTimeout(resolve, 500));
            await loadUserProfile(session.user.id, true); // Force reload after creation
            console.log('Profile created and loaded successfully');
          } catch (createError) {
            console.error('Failed to create profile on auth state change:', createError);
            // If profile creation fails, sign out to prevent broken state
            await supabase.auth.signOut();
          }
        }
      }
      
      // TOKEN_REFRESHED: Don't reload profile, it hasn't changed
      // The session is automatically updated by Supabase
      if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed, session updated (no profile reload needed)');
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      console.log('Auth context cleanup, unsubscribed from auth changes');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        login,
        signUp,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
