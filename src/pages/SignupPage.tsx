import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Shield, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/utils';

const signUpSchema = z
  .object({
    fullName: z.string().min(2, 'Full name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    phone: z.string().min(10, 'Phone number must be at least 10 characters'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type SignUpForm = z.infer<typeof signUpSchema>;

export default function SignUpPage() {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const { signUp } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpForm>({
    resolver: zodResolver(signUpSchema),
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onSubmit = async (data: SignUpForm) => {
    if (!isMountedRef.current) return;
    
    setIsLoading(true);
    console.log('SignupPage: Starting signup process for', data.email);
    
    try {
      console.log('SignupPage: Calling signUp function...');
      await signUp({
        email: data.email,
        password: data.password,
        fullName: data.fullName,
        phone: data.phone,
      });

      if (!isMountedRef.current) {
        console.log('SignupPage: Component unmounted, aborting');
        return;
      }

      // If we get here, signup was successful and user is authenticated
      console.log('SignupPage: Signup successful, navigating to dashboard');
      toast.success('Account created successfully! Redirecting to dashboard...');
      navigate('/dashboard');
    } catch (error) {
      console.error('SignupPage: Signup error caught:', error);
      
      if (!isMountedRef.current) {
        console.log('SignupPage: Component unmounted after error, skipping UI updates');
        return;
      }

      // Check if this is an email confirmation required error
      const errorMessage = getErrorMessage(error, 'Failed to create account');
      console.error('SignupPage: Error message:', errorMessage);
      
      if (errorMessage.includes('CONFIRMATION_REQUIRED:')) {
        // Extract the actual message after the prefix
        const actualMessage = errorMessage.replace('CONFIRMATION_REQUIRED:', '');
        console.log('SignupPage: Email confirmation required, showing success message');
        toast.success('Account created! ' + actualMessage, {
          duration: 6000,
        });
        // Redirect to login page after showing message
        setTimeout(() => {
          if (isMountedRef.current) {
            console.log('SignupPage: Redirecting to login page');
            navigate('/login');
          }
        }, 2000);
      } else {
        // Show error for actual failures
        console.error('SignupPage: Signup failed with error:', errorMessage);
        toast.error(errorMessage);
      }
    } finally {
      // Always reset the loading state
      console.log('SignupPage: Resetting loading state in finally block');
      if (isMountedRef.current) {
        setIsLoading(false);
        console.log('SignupPage: Loading state set to false');
      } else {
        console.log('SignupPage: Component unmounted, skipping loading state reset');
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
          <CardTitle className="text-2xl text-center">Create an account</CardTitle>
          <CardDescription className="text-center">
            Enter your details to get started
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                placeholder="John Doe"
                {...register('fullName')}
                disabled={isLoading}
              />
              {errors.fullName && (
                <p className="text-sm text-destructive">
                  {errors.fullName.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.com"
                {...register('email')}
                disabled={isLoading}
              />
              {errors.email && (
                <p className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+234 800 000 0000"
                {...register('phone')}
                disabled={isLoading}
              />
              {errors.phone && (
                <p className="text-sm text-destructive">
                  {errors.phone.message}
                </p>
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
              />
              {errors.password && (
                <p className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                {...register('confirmPassword')}
                disabled={isLoading}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                'Create account'
              )}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <div className="text-sm text-muted-foreground text-center">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:underline font-medium">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
