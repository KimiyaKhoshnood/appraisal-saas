import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn('-mx-5 overflow-x-auto', className)}>
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th key={i} className="px-5 py-2.5 text-start text-[11px] font-medium tracking-wide text-muted uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <motion.tbody initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.025 } } }} className="divide-y divide-line">
          {children}
        </motion.tbody>
      </table>
    </div>
  );
}

export function Tr({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <motion.tr
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
      onClick={onClick}
      className={cn('transition-colors hover:bg-surface-2/60', onClick && 'cursor-pointer', className)}
    >
      {children}
    </motion.tr>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-5 py-3 align-middle', className)}>{children}</td>;
}
