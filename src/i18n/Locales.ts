import type { CampaignLocaleBundle } from '../campaign/CampaignLocale.ts';

/** One language's file: `src/locales/<code>.yaml`. */
export interface LocaleFile {
  /** Interface strings, looked up by dotted key — `i18n.t`. */
  ui: Record<string, unknown>;
  /** Mission text, laid over `missions.yaml` by mission id and card index — `CampaignLocale`. */
  campaign: CampaignLocaleBundle;
}

/**
 * Every language file on disk, by code.
 *
 * Found by glob rather than imported by name, so a language is added by adding its file. A
 * hand-kept import list is one more step to forget, and forgetting it does not fail: the
 * language quietly resolves to English. `SUPPORTED_LOCALES` still decides what the settings
 * toggle offers, and `I18n.test.ts` fails when the two disagree.
 *
 * The files are YAML because the campaign half is prose edited by hand — no escaping, and
 * room for a translator's note — and they arrive here already parsed: see `vite.config.js`.
 */
const files = import.meta.glob<LocaleFile>('../locales/*.yaml', { eager: true, import: 'default' });

export const LOCALE_FILES: Readonly<Record<string, LocaleFile>> = Object.fromEntries(
  Object.entries(files).map(([path, file]) => [path.slice(path.lastIndexOf('/') + 1, -'.yaml'.length), file]),
);
