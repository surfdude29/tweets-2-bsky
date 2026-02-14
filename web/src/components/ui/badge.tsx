import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none',
  {
  variants: {
    variant: {
      default: 'border-transparent bg-foreground text-background',
      secondary: 'border-transparent bg-muted text-foreground',
      outline: 'border-border text-muted-foreground',
      success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
      warning: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300',
      danger: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
