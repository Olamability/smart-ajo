import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.08)] hover:shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.12)]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        hero: "bg-[linear-gradient(135deg,hsl(var(--primary))_0%,hsl(158_50%_25%)_100%)] text-primary-foreground hover:opacity-90 shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.12)] hover:shadow-[0_16px_48px_-12px_hsl(var(--foreground)/0.18)] hover:-translate-y-0.5",
        accent: "bg-[linear-gradient(135deg,hsl(var(--accent))_0%,hsl(25_95%_50%)_100%)] text-accent-foreground hover:opacity-90 shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.08)] hover:shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.12)]",
        glass: "bg-card/80 backdrop-blur-sm border border-border text-foreground hover:bg-card shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.08)]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-12 rounded-lg px-8 text-base",
        xl: "h-14 rounded-xl px-10 text-lg",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
