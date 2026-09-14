import { LOCALE_FILES } from './Locales.ts';

export interface LocaleOption {
  code: string;
  label: string;
}

/** Every language the settings toggle cycles through; `label` is what it prints. */
export const SUPPORTED_LOCALES: readonly LocaleOption[] = [
  { code: 'en', label: 'ENGLISH' },
  { code: 'de', label: 'DEUTSCH' },
  { code: 'uk', label: 'УКРАЇНСЬКА' },
];

const BUNDLES: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(LOCALE_FILES).map(([code, file]) => [code, file.ui]),
);

type NestedRecord = Record<string, unknown>;

function getNestedValue(obj: NestedRecord | undefined, path: string): string | undefined {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as NestedRecord)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

class I18nService {
  private activeLocale: string = 'en';
  private listeners = new Set<(locale: string) => void>();

  get currentLocale(): string {
    return this.activeLocale;
  }

  get supportedLocales(): readonly LocaleOption[] {
    return SUPPORTED_LOCALES;
  }

  isSupported(locale: string): boolean {
    return SUPPORTED_LOCALES.some((l) => l.code === locale);
  }

  normalizeLocale(locale: string | null | undefined): string {
    if (!locale) return 'en';
    const clean = locale.toLowerCase().split('-')[0];
    return this.isSupported(clean) ? clean : 'en';
  }

  setLocale(locale: string): void {
    const next = this.normalizeLocale(locale);
    if (this.activeLocale === next) return;
    this.activeLocale = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  onLocaleChange(listener: (locale: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Translates a dot-notated key (e.g. `menu.continue`).
   * Supports i18next v4 plural suffixes (_zero, _one, _few, _many, _other) when params.count is present.
   * Interpolates {{param}} or {param}.
   */
  t(key: string, params?: Record<string, string | number>): string {
    const bundle = BUNDLES[this.activeLocale] ?? BUNDLES.en;
    let template: string | undefined;

    if (params && typeof params.count === 'number') {
      try {
        if (params.count === 0) {
          template =
            getNestedValue(bundle, `${key}_zero`) ??
            getNestedValue(BUNDLES.en, `${key}_zero`);
        }
        if (!template) {
          const pr = new Intl.PluralRules(this.activeLocale);
          const rule = pr.select(params.count);
          template =
            getNestedValue(bundle, `${key}_${rule}`) ??
            getNestedValue(bundle, `${key}_other`) ??
            getNestedValue(BUNDLES.en, `${key}_${rule}`) ??
            getNestedValue(BUNDLES.en, `${key}_other`);
        }
      } catch {
        template = getNestedValue(bundle, `${key}_other`);
      }
    }

    template ??= getNestedValue(bundle, key) ?? getNestedValue(BUNDLES.en, key) ?? key;

    if (!params) return template;

    return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, a, b) => {
      const paramName = a || b;
      return paramName in params ? String(params[paramName]) : `{${paramName}}`;
    });
  }

  /**
   * Formats ordinals according to locale (e.g. 54 -> 54TH in en, 54. in de).
   * Used for Helion centile interpolation in debriefs.
   */
  formatOrdinal(n: number, locale = this.activeLocale): string {
    if (locale === 'de') {
      return `${n}.`;
    }
    if (locale === 'uk') {
      return `${n}-Й`;
    }
    // English default
    try {
      const pr = new Intl.PluralRules('en', { type: 'ordinal' });
      const rule = pr.select(n);
      const suffix =
        ({
          one: 'ST',
          two: 'ND',
          few: 'RD',
          other: 'TH',
        } as Record<string, string>)[rule] ?? 'TH';
      return `${n}${suffix}`;
    } catch {
      const tens = n % 100;
      if (tens >= 11 && tens <= 13) return `${n}TH`;
      return `${n}${({ 1: 'ST', 2: 'ND', 3: 'RD' } as Record<number, string>)[n % 10] ?? 'TH'}`;
    }
  }
}

export const i18n = new I18nService();
export const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
