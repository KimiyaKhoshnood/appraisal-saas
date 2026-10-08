import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { translate, type LocaleKey, type MessageKey } from './messages';

interface I18n {
  locale: LocaleKey;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  formatDate: (iso: string) => string;
  formatDateTime: (iso: string) => string;
  formatNumber: (n: number) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: LocaleKey; children: ReactNode }) {
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
  const value = useMemo<I18n>(() => {
    // fa uses the Persian (Solar Hijri) calendar and digits; en uses ISO-like formats.
    const tag = locale === 'fa' ? 'fa-IR' : 'en-GB';
    const date = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' });
    const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' });
    const num = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
    return {
      locale,
      t,
      formatDate: (iso) => date.format(new Date(iso)),
      formatDateTime: (iso) => dateTime.format(new Date(iso)),
      formatNumber: (n) => num.format(n),
    };
  }, [locale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
