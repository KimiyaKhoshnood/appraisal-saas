import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/cn';

const control =
  'focus-ring block w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg shadow-xs transition-colors placeholder:text-muted/70 hover:border-zinc-400/60 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-red-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} className={cn(control, 'h-9', props.className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(props, ref) {
  return <select ref={ref} {...props} className={cn(control, 'h-9 pe-8', props.className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) {
  return <textarea ref={ref} {...props} className={cn(control, 'py-2', props.className)} />;
});

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: (id: string, invalid: boolean) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children(id, Boolean(error))}
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p key="e" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-red-600 dark:text-red-400">
            {error}
          </motion.p>
        ) : hint ? (
          <motion.p key="h" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-muted">
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
