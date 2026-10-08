import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-white shadow-sm shadow-brand/20 hover:brightness-110 active:brightness-95 disabled:opacity-50 bg-gradient-to-b from-white/10 to-transparent',
  secondary: 'bg-surface text-fg ring-1 ring-line hover:bg-surface-2 disabled:opacity-50',
  soft: 'bg-brand-soft text-brand-text hover:bg-brand-soft/70 disabled:opacity-50',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', busy, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      disabled={disabled || busy}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[filter,background-color,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
