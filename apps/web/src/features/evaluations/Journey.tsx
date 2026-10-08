import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import type { EvaluationPolicy, EvaluationStatus } from '@appraisal/contracts';
import { useI18n } from '../../shared/i18n/i18n';
import { cn } from '../../shared/lib/cn';

/** The statuses this cycle's policy actually uses; mirrors the server's state machine. */
export function journeySteps(policy: EvaluationPolicy): EvaluationStatus[] {
  const steps: EvaluationStatus[] = ['DRAFT'];
  if (policy.selfAssessmentRequired) steps.push('SELF_SUBMITTED');
  if (policy.approvalRequired) {
    steps.push('MANAGER_SUBMITTED');
    if (policy.approvalStrategy === 'TWO_STAGE') steps.push('PENDING_APPROVAL');
  }
  steps.push('PUBLISHED');
  return steps;
}

/**
 * "Configuration over code", made visible: the same component draws two steps for a tenant
 * without self-assessment or approval and five for one with two-stage approval.
 */
export function Journey({ policy, status }: { policy: EvaluationPolicy; status: EvaluationStatus }) {
  const { t } = useI18n();
  const steps = journeySteps(policy);
  const current = Math.max(0, steps.indexOf(status));
  const done = status === 'PUBLISHED';
  const progress = steps.length > 1 ? current / (steps.length - 1) : 1;

  return (
    <div className="relative">
      <div className="absolute inset-x-4 top-4 h-0.5 rounded-full bg-line" />
      <motion.div
        className="absolute start-4 top-4 h-0.5 rounded-full bg-gradient-to-r from-brand to-brand-2 rtl:bg-gradient-to-l"
        initial={{ width: 0 }}
        animate={{ width: `calc((100% - 2rem) * ${progress})` }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
      <ol className="relative flex justify-between">
        {steps.map((s, i) => {
          const complete = i < current || done;
          const active = i === current && !done;
          return (
            <li key={s} className="flex w-20 flex-col items-center gap-2 text-center sm:w-28">
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.08, type: 'spring', stiffness: 400, damping: 22 }}
                className={cn(
                  'relative grid size-8 place-items-center rounded-full border-2 text-xs font-semibold',
                  complete && 'border-transparent bg-brand text-white',
                  active && 'border-brand bg-surface text-brand-text',
                  !complete && !active && 'border-line bg-surface text-muted',
                )}
              >
                {complete ? <Check className="size-4" /> : i + 1}
                {active && <span className="absolute inset-0 animate-ping rounded-full border-2 border-brand opacity-40" />}
              </motion.span>
              <span className={cn('text-[11px] leading-tight', active || complete ? 'font-medium text-fg' : 'text-muted')}>{t(`status.${s}`)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
