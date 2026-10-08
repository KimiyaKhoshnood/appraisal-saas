import { useI18n } from '../i18n/i18n';

/**
 * Dependency-free charts. Colours come from the brand tokens; every chart also prints its
 * values as text, so nothing is conveyed by colour or shape alone.
 */
export function BarList({ items }: { items: { label: string; value: number }[] }) {
  const { formatNumber } = useI18n();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(8rem,14rem)_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate text-slate-600">{i.label}</span>
          <span className="h-2.5 rounded-full bg-slate-100">
            <span className="block h-2.5 rounded-full bg-brand" style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="text-end font-medium tabular-nums">{formatNumber(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ColumnChart({ items }: { items: { label: string; value: number }[] }) {
  const { formatNumber } = useI18n();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div role="img" aria-label={items.map((i) => `${i.label}: ${i.value}`).join(', ')} dir="ltr">
      <div className="flex h-48 items-end gap-1.5 border-b border-slate-200">
        {items.map((i) => (
          <div key={i.label} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs font-medium text-slate-600 tabular-nums">{i.value ? formatNumber(i.value) : ''}</span>
            <div className="w-full rounded-t bg-brand" style={{ height: `${(i.value / max) * 85}%`, minHeight: i.value ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {items.map((i) => (
          <span key={i.label} className="flex-1 text-center text-[10px] text-slate-500">
            {i.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LineChart({ points, max }: { points: { label: string; value: number | null }[]; max: number }) {
  const { formatNumber } = useI18n();
  const w = 400;
  const h = 180;
  const pad = 24;
  const xs = (i: number) => pad + (points.length <= 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (points.length - 1));
  const ys = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const valid = points.map((p, i) => ({ ...p, i })).filter((p): p is { label: string; value: number; i: number } => p.value !== null);
  const d = valid.map((p, k) => `${k ? 'L' : 'M'}${xs(p.i)},${ys(p.value)}`).join(' ');
  return (
    <figure dir="ltr">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={points.map((p) => `${p.label}: ${p.value ?? '—'}`).join(', ')}>
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={pad} x2={w - pad} y1={ys(g)} y2={ys(g)} stroke="#e2e8f0" />
            <text x={4} y={ys(g) + 4} fontSize="10" fill="#64748b">
              {g}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--brand)" strokeWidth={2.5} />
        {valid.map((p) => (
          <g key={p.i}>
            <circle cx={xs(p.i)} cy={ys(p.value)} r={4} fill="var(--brand)" />
            <text x={xs(p.i)} y={ys(p.value) - 8} fontSize="11" textAnchor="middle" fill="#0f172a">
              {formatNumber(p.value)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="flex justify-between px-4 text-xs text-slate-500">
        {points.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </figcaption>
    </figure>
  );
}
