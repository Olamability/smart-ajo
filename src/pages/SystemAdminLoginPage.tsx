import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Loader2, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';

const adminLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type AdminLoginForm = z.infer<typeof adminLoginSchema>;

export default function SystemAdminLoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const { login, user } = useAuth();

  const { register, handleSubmit, formState: { errors } } = useForm<AdminLoginForm>({
    resolver: zodResolver(adminLoginSchema),
  });

  useEffect(() => {
    isMountedRef.current = true;
    
    // Handle admin user redirection and access control
    if (user) {
      if (user.isAdmin) {
        // User is admin, redirect to admin dashboard
        navigate('/admin');
      } else {
        // User is logged in but not admin, show error and redirect
        toast.error('Access denied. This account is not a system administrator.');
        setTimeout(() => {
          navigate('/dashboard');
        }, 2000);
      }
    }
    
    return () => {
      isMountedRef.current = false;
    };
  }, [user, navigate]);

  const onSubmit = async (data: AdminLoginForm) => {
    if (!isMountedRef.current) return;

    setIsLoading(true);
    console.log('SystemAdminLogin: Starting admin login for:', data.email);
    
    try {
      console.log('SystemAdminLogin: Calling login function...');
      await login(data.email, data.password);
      
      // Wait a bit for auth state to update
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('SystemAdminLogin: Login successful, checking admin status');
      
      // The login function will update the user context
      // We need to check if the logged-in user is actually an admin
      // This will be handled by the useEffect above
      
    } catch (error: unknown) {
      if (!isMountedRef.current) return;
      
      console.error('SystemAdminLogin: Login error:', error);
      const errorMessage = getErrorMessage(error, 'Failed to log in');
      
      if (errorMessage.includes('Invalid login credentials')) {
        toast.error('Invalid email or password');
      } else if (errorMessage.includes('Email not confirmed')) {
        toast.error('Please verify your email address before logging in');
      } else {
        toast.error(errorMessage || 'Failed to log in');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground mb-4 shadow-lg">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold mb-2">System Administrator</h1>
          <p className="text-muted-foreground">
            Sign in to access the admin dashboard
          </p>
        </div>

        <Card className="shadow-xl border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Admin Login
            </CardTitle>
            <CardDescription>
              Enter your administrator credentials
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert className="mb-4 bg-amber-50 border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-900 text-sm">
                This login is for system administrators only. Regular users should use the <Link to="/login" className="underline font-semibold">standard login page</Link>.
              </AlertDescription>
            </Alert>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@smartajo.com"
                  {...register('email')}
                  disabled={isLoading}
                  className="h-11"
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  {...register('password')}
                  disabled={isLoading}
                  className="h-11"
                />
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-11"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-4 w-4" />
                    Sign In as Admin
                  </>
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col space-y-2">
            <div className="text-sm text-muted-foreground text-center">
              Not an admin?{' '}
              <Link to="/login" className="text-primary hover:underline font-semibold">
                Regular login
              </Link>
            </div>
            <div className="text-xs text-muted-foreground text-center">
              Need admin access?{' '}
              <Link to="/" className="text-primary hover:underline">
                Contact support
              </Link>
            </div>
          </CardFooter>
        </Card>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>
            Secured by <strong>SmartAjo</strong> • All rights reserved
          </p>
        </div>
      </div>
    </div>
  );
}
