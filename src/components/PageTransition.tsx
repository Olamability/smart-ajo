import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wraps page content with a fade-in transition animation.
 * Uses CSS animation for lightweight performance (no Framer Motion dependency).
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <div className={cn('animate-fade-in', className)}>
      {children}
    </div>
  );
}

export default PageTransition;
