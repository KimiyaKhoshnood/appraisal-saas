import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useI18n } from '../i18n/i18n';
import { ease } from './motion';

/*
 * Single-series, dependency-free charts in the tenant's brand colour (validated for contrast
 * when the tenant saves it). Mark rules: thin marks with rounded data-ends anchored to the
 * baseline, a recessive grid, text in text tokens (never the series colour), a hover tooltip on
 * every mark, and the full data as an accessible description.
 */

interface Datum {
  label: string;
  value: number;
}

function Tooltip({ show, left, top, label, value }: { show: boolean; left: string; top: string; label: string; value: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-pop"
          style={{ left, top, marginTop: -8 }}
        >
          <div className="text-muted">{label}</div>
          <div className="font-semibold text-fg tabular">{value}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Horizontal bars: comparisons between named items (e.g. competencies). */
export function BarList({ items, max }: { items: Datum[]; max?: number }) {
  const { formatNumber } = useI18n();
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3" aria-label={items.map((i) => `${i.label}: ${i.value}`).join(', ')}>
      {items.map((i, idx) => (
        <li key={i.label} className="grid grid-cols-[minmax(7rem,13rem)_1fr_3.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted" title={i.label}>
            {i.label}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-2">
            <motion.span
              className="block h-2 rounded-full bg-brand"
              initial={{ width: 0 }}
              animate={{ width: `${(i.value / top) * 100}%` }}
              transition={{ ...ease, duration: 0.7, delay: idx * 0.05 }}
            />
          </span>
          <span className="text-end font-medium text-fg tabular">{formatNumber(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns with a hover tooltip: distributions (score buckets). */
export function ColumnChart({ items, height = 200 }: { items: Datum[]; height?: number }) {
  const { formatNumber } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, ...items.map((i) => i.value));
  const grid = [0.5, 1];
  return (
    <div className="relative" dir="ltr" role="img" aria-label={items.map((i) => `${i.label}: ${i.value}`).join(', ')}>
      <div className="relative" style={{ height }}>
        {grid.map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-1.5 border-b border-line">
          {items.map((i, idx) => (
            <div
              key={i.label}
              className="relative flex h-full flex-1 cursor-default items-end"
              onMouseEnter={() => setHover(idx)}
              onMouseLeave={() => setHover(null)}
            >
              <motion.div
                className="w-full rounded-t-[4px] bg-brand"
                style={{ opacity: hover === null || hover === idx ? 1 : 0.45 }}
                initial={{ height: 0 }}
                animate={{ height: `${(i.value / top) * 100}%` }}
                transition={{ ...ease, duration: 0.6, delay: idx * 0.035 }}
              />
              <Tooltip show={hover === idx} left="50%" top={`${100 - (i.value / top) * 100}%`} label={i.label} value={formatNumber(i.value)} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        {items.map((i) => (
          <span key={i.label} className="flex-1 text-center text-[10px] text-muted tabular">
            {i.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Line with area and crosshair tooltip: change over time (average per cycle). */
export function LineChart({ points, max = 100 }: { points: { label: string; value: number | null }[]; max?: number }) {
  const { formatNumber } = useI18n();
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  const w = 560;
  const h = 220;
  const pad = { l: 32, r: 16, t: 16, b: 28 };
  const x = (i: number) => pad.l + (points.length <= 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b);
  const valid = points.map((p, i) => ({ ...p, i })).filter((p): p is { label: string; value: number; i: number } => p.value !== null);
  const line = valid.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.value)}`).join(' ');
  const area = valid.length ? `${line} L${x(valid.at(-1)!.i)},${y(0)} L${x(valid[0]!.i)},${y(0)} Z` : '';
  const hovered = hover === null ? null : valid.find((p) => p.i === hover);

  return (
    <div className="relative" dir="ltr">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={points.map((p) => `${p.label}: ${p.value ?? '—'}`).join(', ')}>
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={w - pad.r} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeDasharray={g ? '3 4' : undefined} />
            <text x={pad.l - 8} y={y(g) + 4} fontSize="10" textAnchor="end" fill="var(--text-muted)">
              {g}
            </text>
          </g>
        ))}
        {area && <motion.path d={area} fill={`url(#${gradient})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.6 }} />}
        <motion.path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
        {hovered && <line x1={x(hovered.i)} x2={x(hovered.i)} y1={pad.t} y2={y(0)} stroke="var(--text-muted)" strokeOpacity={0.4} />}
        {valid.map((p) => (
          <g key={p.i}>
            <motion.circle
              cx={x(p.i)}
              cy={y(p.value)}
              r={hover === p.i ? 6 : 4}
              fill="var(--brand)"
              stroke="var(--surface)"
              strokeWidth={2}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.6 + p.i * 0.08 }}
            />
            {/* Hit target larger than the mark. */}
            <rect x={x(p.i) - 20} y={pad.t} width={40} height={h - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(p.i)} onMouseLeave={() => setHover(null)} />
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.label} x={x(i)} y={h - 8} fontSize="10" textAnchor="middle" fill="var(--text-muted)">
            {p.label}
          </text>
        ))}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop"
          style={{ left: `${(x(hovered.i) / w) * 100}%`, top: `${(y(hovered.value) / h) * 100}%`, marginTop: -10 }}
        >
          <div className="text-muted">{hovered.label}</div>
          <div className="font-semibold text-fg tabular">{formatNumber(hovered.value)}</div>
        </div>
      )}
    </div>
  );
}
