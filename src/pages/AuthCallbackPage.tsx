import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@/lib/client/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Constants for better maintainability
const SUPABASE_SESSION_DELAY = 1000; // Wait time for Supabase to process confirmation
const REDIRECT_DELAY = 2000; // Delay before redirecting after success

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const handleEmailConfirmation = async () => {
      try {
        const supabase = createClient();
        
        // Get the hash from the URL (Supabase sends confirmation as #access_token=...)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const type = hashParams.get('type');
        
        if (import.meta.env.DEV) {
          console.log('Auth callback - type:', type, 'has access token:', !!accessToken);
        }

        if (type === 'signup' && accessToken) {
          // Email confirmation successful
          if (import.meta.env.DEV) {
            console.log('Email confirmation detected, verifying session...');
          }
          
          // Wait a moment for Supabase to process the confirmation
          await new Promise(resolve => setTimeout(resolve, SUPABASE_SESSION_DELAY));
          
          // Check if we have a valid session
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError) {
            console.error('Session error:', sessionError);
            throw new Error('Failed to verify your session. Please try logging in.');
          }

          if (session) {
            if (import.meta.env.DEV) {
              console.log('Session confirmed, email verified successfully');
            }
            setStatus('success');
            
            // Redirect to dashboard after a short delay
            setTimeout(() => {
              navigate('/dashboard', { replace: true });
            }, REDIRECT_DELAY);
          } else {
            if (import.meta.env.DEV) {
              console.log('No session found, redirecting to login');
            }
            setStatus('success');
            setTimeout(() => {
              navigate('/login', { replace: true });
            }, REDIRECT_DELAY);
          }
        } else if (type === 'recovery') {
          // Password recovery flow
          if (import.meta.env.DEV) {
            console.log('Password recovery detected');
          }
          navigate('/reset-password', { replace: true });
        } else {
          // No valid confirmation token
          if (import.meta.env.DEV) {
            console.log('No valid confirmation parameters found');
          }
          throw new Error('Invalid confirmation link. Please try signing up again.');
        }
      } catch (error) {
        console.error('Email confirmation error:', error);
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Something went wrong during email confirmation.');
      }
    };

    handleEmailConfirmation();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center">
            {status === 'loading' && 'Verifying Your Email'}
            {status === 'success' && 'Email Verified!'}
            {status === 'error' && 'Verification Failed'}
          </CardTitle>
          <CardDescription className="text-center">
            {status === 'loading' && 'Please wait while we confirm your email address...'}
            {status === 'success' && 'Your email has been successfully verified. Redirecting you now...'}
            {status === 'error' && 'There was a problem verifying your email.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          {status === 'loading' && (
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          )}
          
          {status === 'success' && (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="text-sm text-muted-foreground text-center">
                Welcome to Smart Ajo! You'll be redirected to your dashboard shortly.
              </p>
            </>
          )}
          
          {status === 'error' && (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-destructive text-center">
                {errorMessage}
              </p>
              <div className="flex gap-2 w-full">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate('/signup')}
                >
                  Try Again
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => navigate('/login')}
                >
                  Go to Login
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
