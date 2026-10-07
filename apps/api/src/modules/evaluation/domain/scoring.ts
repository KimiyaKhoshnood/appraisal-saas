import type { EvaluationPolicy } from '@appraisal/contracts';

export interface WeightedScore {
  weight: number;
  score: number;
}

/**
 * Final score on a 0–100 scale, independent of each tenant's rating scale: every competency
 * score is normalised to [0, 1] within the cycle's scale, then weighted (weights sum to 100).
 * A 4 on a 1–5 scale and a 7.75 on a 1–10 scale both become 75.
 */
export function finalScore(scores: WeightedScore[], scale: EvaluationPolicy['scale']): number {
  const span = scale.max - scale.min;
  const totalWeight = scores.reduce((s, x) => s + x.weight, 0);
  if (span <= 0 || totalWeight === 0) return 0;
  const weighted = scores.reduce((sum, { weight, score }) => sum + weight * ((score - scale.min) / span), 0);
  return Math.round((weighted / totalWeight) * 100 * 100) / 100;
}

export function outOfScale(score: number, scale: EvaluationPolicy['scale']): boolean {
  return !Number.isInteger(score) || score < scale.min || score > scale.max;
}

/** First day after a cycle of the given cadence starting on `startsOn` (inclusive end = day before). */
export function cycleEnd(startsOn: Date, cadence: EvaluationPolicy['cycle']): Date {
  const months = cadence === 'MONTHLY' ? 1 : cadence === 'QUARTERLY' ? 3 : 12;
  const end = new Date(Date.UTC(startsOn.getUTCFullYear(), startsOn.getUTCMonth() + months, startsOn.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}
