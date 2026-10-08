import { cn } from '../lib/cn';

/** Content-shaped placeholder; the shimmer is CSS and disappears under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-[length:200%_100%]',
        'bg-[linear-gradient(90deg,var(--surface-2)_0%,color-mix(in_oklab,var(--surface-2)_40%,var(--surface))_50%,var(--surface-2)_100%)]',
        className,
      )}
    />
  );
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-1/4' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-line bg-surface p-5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="mt-4 h-7 w-1/2" />
        </div>
      ))}
    </div>
  );
}
