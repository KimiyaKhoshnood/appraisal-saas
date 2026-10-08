import { useEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';
import { useI18n } from '../i18n/i18n';

/** Animates a number from 0 when it scrolls into view; formatted in the tenant's locale. */
export function CountUp({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const { locale } = useI18n();

  useEffect(() => {
    const node = ref.current;
    if (!node || !inView) return;
    const fmt = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
    if (reduce) {
      node.textContent = fmt.format(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => (node.textContent = fmt.format(v)),
    });
    return () => controls.stop();
  }, [value, decimals, inView, reduce, locale]);

  return <span ref={ref} className={className} />;
}
