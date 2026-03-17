import { forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ComponentPropsWithoutRef } from 'react';

type ButtonProps = ComponentPropsWithoutRef<typeof Button>;

interface AnimatedButtonProps extends ButtonProps {
  successState?: boolean;
  errorState?: boolean;
}

const AnimatedButton = forwardRef<HTMLButtonElement, AnimatedButtonProps>(
  ({ className, successState, errorState, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        className={cn(
          'hover:shadow-md hover:-translate-y-0.5',
          successState && 'bg-green-600 hover:bg-green-700 animate-pulse-soft',
          errorState && 'bg-destructive animate-shake',
          className
        )}
        {...props}
      >
        {children}
      </Button>
    );
  }
);

AnimatedButton.displayName = 'AnimatedButton';

export { AnimatedButton };
export default AnimatedButton;
