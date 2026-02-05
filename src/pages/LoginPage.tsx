import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { mapAuthErrorToMessage, isEmailConfirmationRequired } from '@/lib/utils/authErrors';
import { reportError } from '@/lib/utils/errorTracking';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const { login } = useAuth();

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    // Track if component is mounted to prevent state updates after unmount
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onSubmit = async (data: LoginForm) => {
    if (!isMountedRef.current) return;

    setIsLoading(true);
    console.log('LoginPage: Starting login for:', data.email);
    
    try {
      console.log('LoginPage: Calling login function...');
      await login(data.email, data.password);
      
      if (!isMountedRef.current) {
        console.log('LoginPage: Component unmounted, aborting');
        return;
      }

      console.log('LoginPage: Login successful, navigating to dashboard');
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (error) {
      if (!isMountedRef.current) return;

      console.error('LoginPage: Login failed with error:', error);
      
      // Report error with context for tracking
      reportError(error, {
        operation: 'login',
        email: data.email,
      });
      
      // Use the new auth error mapping utility for user-friendly messages
      const errorMessage = mapAuthErrorToMessage(error);
      console.error('LoginPage: Showing error to user:', errorMessage);
      
      // Show different toast styles for email confirmation vs other errors
      if (isEmailConfirmationRequired(error)) {
        toast.warning(errorMessage, { duration: 6000 });
      } else {
        toast.error(errorMessage);
      }
    } finally {
      // ALWAYS reset loading state, whether success or failure
      if (isMountedRef.current) {
        console.log('LoginPage: Resetting loading state');
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center">Welcome back</CardTitle>
          <CardDescription className="text-center">
            Enter your credentials to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="john@example.com" 
                {...register('email')} 
                disabled={isLoading} 
              />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password" 
                type="password" 
                placeholder="••••••••" 
                {...register('password')} 
                disabled={isLoading} 
              />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...
                </>
              ) : 'Sign in'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <div className="text-sm text-muted-foreground text-center">
            Don't have an account?{' '}
            <Link to="/signup" className="text-primary hover:underline font-medium">
              Sign up
            </Link>
          </div>
          <div className="text-xs text-muted-foreground text-center">
            System administrator?{' '}
            <Link to="/admin/login" className="text-primary hover:underline font-medium">
              Admin login
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
