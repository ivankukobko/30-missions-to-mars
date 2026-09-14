import { describe, it, expect, beforeEach } from 'vitest';
import { i18n, t, SUPPORTED_LOCALES } from './I18n.ts';
import { LOCALE_FILES } from './Locales.ts';

/**
 * The service's mechanics, and each language's agreement with English.
 *
 * No test here quotes a translation. What `t` has to get right is *which* string it picks —
 * the key, the plural form, the fallback — and that is checkable against the bundle itself,
 * which leaves the wording free to change without a test to update.
 */

const bundle = (code: string) => LOCALE_FILES[code]?.ui;
const LOCALES = SUPPORTED_LOCALES.map((l) => l.code);
const PLURAL = /_(zero|one|two|few|many|other)$/;

function leaves(node: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof node === 'string') return out.set(prefix, node);
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    leaves(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/** The authored string at `key` in one language, before interpolation. */
const raw = (code: string, key: string) => leaves(bundle(code)).get(key)!;

/** Each key with its plural suffix folded away, and the `{{params}}` any of its forms use. */
function placeholders(node: unknown): Map<string, string[]> {
  const found = new Map<string, Set<string>>();
  for (const [key, text] of leaves(node)) {
    const base = key.replace(PLURAL, '');
    const names = found.get(base) ?? new Set<string>();
    for (const [, name] of text.matchAll(/\{\{(\w+)\}\}/g)) names.add(name);
    found.set(base, names);
  }
  return new Map([...found].map(([key, names]) => [key, [...names].sort()]));
}

describe('I18nService', () => {
  beforeEach(() => {
    i18n.setLocale('en');
  });

  it('has a file for exactly the languages it offers', () => {
    // A file nobody can pick is dead weight in the bundle; a language offered without a
    // file is English wearing another language's label.
    expect(Object.keys(LOCALE_FILES).sort()).toEqual([...LOCALES].sort());
    for (const code of LOCALES) expect(bundle(code), `${code} ui`).toBeDefined();
  });

  // Plural forms are folded before comparing: Ukrainian needs `_few` and `_many` where
  // English has only `_one` and `_other`, and that is a difference in grammar, not a gap.
  for (const code of LOCALES.filter((c) => c !== 'en')) {
    it(`gives ${code} every key and placeholder English has, and nothing else`, () => {
      const english = placeholders(bundle('en'));
      const own = placeholders(bundle(code));
      expect([...own.keys()].sort()).toEqual([...english.keys()].sort());
      for (const [key, names] of english) expect(own.get(key), key).toEqual(names);
    });
  }

  it("resolves every key from the active language's own bundle", () => {
    // Catches strings that do not reach `t` — a `ui:` section missing or nested a level too
    // deep — which otherwise read as a finished translation that happens to be in English.
    // Also where an unquoted YAML value that parsed as something other than text shows up.
    for (const code of LOCALES) {
      i18n.setLocale(code);
      for (const [key, text] of leaves(bundle(code))) {
        if (!PLURAL.test(key)) expect(t(key), `${code} ${key}`).toBe(text);
      }
    }
  });

  it('interpolates {{param}}', () => {
    expect(t('menu.seed_n', { seed: 12345 })).toBe(raw('en', 'menu.seed_n').replace('{{seed}}', '12345'));
  });

  it("picks each language's own plural form", () => {
    const form = (code: string, suffix: string, n: number) =>
      raw(code, `history.runs_${suffix}`).replace('{{count}}', String(n));

    expect(t('history.runs', { count: 0 })).toBe(form('en', 'zero', 0));
    expect(t('history.runs', { count: 1 })).toBe(form('en', 'one', 1));
    expect(t('history.runs', { count: 5 })).toBe(form('en', 'other', 5));

    i18n.setLocale('de');
    expect(t('history.runs', { count: 1 })).toBe(form('de', 'one', 1));
    expect(t('history.runs', { count: 4 })).toBe(form('de', 'other', 4));

    // The Slavic rules are the ones worth pinning: 21 takes the singular and 11 does not.
    i18n.setLocale('uk');
    expect(t('history.runs', { count: 0 })).toBe(form('uk', 'zero', 0));
    expect(t('history.runs', { count: 1 })).toBe(form('uk', 'one', 1));
    expect(t('history.runs', { count: 2 })).toBe(form('uk', 'few', 2));
    expect(t('history.runs', { count: 5 })).toBe(form('uk', 'many', 5));
    expect(t('history.runs', { count: 11 })).toBe(form('uk', 'many', 11));
    expect(t('history.runs', { count: 21 })).toBe(form('uk', 'one', 21));
    expect(t('history.runs', { count: 24 })).toBe(form('uk', 'few', 24));
  });

  it('returns the key itself for a path no bundle has', () => {
    expect(t('nonexistent.key.here')).toBe('nonexistent.key.here');
  });

  it('reduces a browser language to one it offers, or English', () => {
    expect(i18n.normalizeLocale('de-CH')).toBe('de');
    expect(i18n.normalizeLocale('uk-UA')).toBe('uk');
    expect(i18n.normalizeLocale('fr-FR')).toBe('en');
    expect(i18n.normalizeLocale(null)).toBe('en');
  });

  it('notifies onLocaleChange listeners until unsubscribed', () => {
    let notified: string | null = null;
    const unsub = i18n.onLocaleChange((locale) => {
      notified = locale;
    });

    i18n.setLocale('de');
    expect(notified).toBe('de');

    unsub();
    i18n.setLocale('en');
    expect(notified).toBe('de');
  });

  it('formats ordinals per language', () => {
    expect(i18n.formatOrdinal(1, 'en')).toBe('1ST');
    expect(i18n.formatOrdinal(2, 'en')).toBe('2ND');
    expect(i18n.formatOrdinal(3, 'en')).toBe('3RD');
    expect(i18n.formatOrdinal(11, 'en')).toBe('11TH');
    expect(i18n.formatOrdinal(54, 'en')).toBe('54TH');

    expect(i18n.formatOrdinal(1, 'de')).toBe('1.');
    expect(i18n.formatOrdinal(54, 'de')).toBe('54.');

    expect(i18n.formatOrdinal(1, 'uk')).toBe('1-Й');
    expect(i18n.formatOrdinal(54, 'uk')).toBe('54-Й');
  });
});
