import type { Branding } from '@appraisal/contracts';

/**
 * Applies a tenant's branding to the document: CSS variables, language, direction and title.
 * Colours were validated server-side (hex + WCAG contrast); nothing here is interpolated into
 * markup, only into CSS custom properties.
 */
export function applyBranding(b: Pick<Branding, 'appName' | 'primaryColor' | 'secondaryColor' | 'locale'>): void {
  const root = document.documentElement;
  root.style.setProperty('--brand', b.primaryColor);
  root.style.setProperty('--brand-2', b.secondaryColor);
  root.lang = b.locale;
  root.dir = b.locale === 'fa' ? 'rtl' : 'ltr';
  document.title = b.appName;
}
