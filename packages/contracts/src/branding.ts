import { z } from 'zod';

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour such as #1d4ed8')
  .transform((v) => v.toLowerCase());

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour the UI renders on top of the primary colour: whichever contrasts more. */
export function onColor(hex: string): '#ffffff' | '#000000' {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#000000') ? '#ffffff' : '#000000';
}

export const MIN_CONTRAST = 4.5;

export const LOCALES = ['en', 'fa'] as const;
export type Locale = (typeof LOCALES)[number];

export const brandingSchema = z
  .object({
    appName: z.string().trim().min(2).max(60),
    logoUrl: z
      .url({ protocol: /^https?$/ })
      .max(500)
      .nullable(),
    primaryColor: hexColor,
    secondaryColor: hexColor,
    locale: z.enum(LOCALES),
  })
  .strict()
  .superRefine((b, ctx) => {
    // A tenant must not be able to make the product unreadable (WCAG AA, 4.5:1).
    const ratio = contrastRatio(b.primaryColor, onColor(b.primaryColor));
    if (ratio < MIN_CONTRAST) {
      ctx.addIssue({
        code: 'custom',
        path: ['primaryColor'],
        message: `Text on this colour reaches only ${ratio.toFixed(2)}:1 contrast; at least ${MIN_CONTRAST}:1 is required`,
      });
    }
  });

export type Branding = z.infer<typeof brandingSchema>;

export const DEFAULT_BRANDING: Branding = {
  appName: 'Appraisal',
  logoUrl: null,
  primaryColor: '#1d4ed8',
  secondaryColor: '#0f766e',
  locale: 'en',
};

/** What the unauthenticated login page may see. Nothing else about a tenant is public. */
export type PublicBranding = Branding & { tenantName: string };
