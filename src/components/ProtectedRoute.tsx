import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';

interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isAuthenticated, loading } = useAuth();
  
  // Check for development bypass flag (only in development!)
  const bypassAuth = import.meta.env.VITE_BYPASS_AUTH === 'true' && import.meta.env.DEV;
  
  if (bypassAuth) {
    console.warn('⚠️ BYPASS_AUTH is enabled - authentication is bypassed. This should ONLY be used in development!');
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 p-8">
        {/* Brand logo skeleton */}
        <div className="flex items-center gap-2 mb-2">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <Skeleton className="h-5 w-28" />
        </div>
        {/* Dashboard layout skeleton */}
        <div className="w-full max-w-5xl space-y-4">
          <div className="flex gap-4">
            {/* Sidebar skeleton */}
            <div className="hidden md:flex flex-col gap-3 w-52 flex-shrink-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-md" />
              ))}
            </div>
            {/* Main content skeleton */}
            <div className="flex-1 space-y-4">
              <Skeleton className="h-8 w-48" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground animate-pulse">Loading your dashboard…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
