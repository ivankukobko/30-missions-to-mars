import { i18n } from '../i18n/I18n.ts';
import { LOCALE_FILES } from '../i18n/Locales.ts';

export interface CampaignLocaleMessage {
  sender?: string;
  content: string;
}

export interface CampaignLocaleDebrief {
  sender?: string;
  content?: string;
  strong?: string;
  weak?: string;
}

export interface CampaignLocaleRadio {
  sender?: string;
  content: string;
}

export interface CampaignLocaleMission {
  payloadName?: string;
  goal?: string;
  messages?: CampaignLocaleMessage[];
  debrief?: CampaignLocaleDebrief;
  radio?: CampaignLocaleRadio[];
}

export interface CampaignLocaleBundle {
  defaultGoal?: string;
  missions?: Record<string, CampaignLocaleMission>;
  epilogue?: CampaignLocaleMessage[];
}

const CAMPAIGN_BUNDLES: Record<string, CampaignLocaleBundle> = Object.fromEntries(
  Object.entries(LOCALE_FILES).map(([code, file]) => [code, file.campaign]),
);

export function getCampaignBundle(locale: string = i18n.currentLocale): CampaignLocaleBundle {
  return CAMPAIGN_BUNDLES[locale] ?? CAMPAIGN_BUNDLES.en;
}

export function getMissionOverlay(
  missionId: number,
  locale: string = i18n.currentLocale,
): CampaignLocaleMission | undefined {
  const bundle = getCampaignBundle(locale);
  return bundle.missions?.[String(missionId)];
}

export function getEpilogueOverlay(
  locale: string = i18n.currentLocale,
): CampaignLocaleMessage[] | undefined {
  const bundle = getCampaignBundle(locale);
  return bundle.epilogue;
}

export function getDefaultGoal(locale: string = i18n.currentLocale): string {
  const bundle = getCampaignBundle(locale);
  return bundle.defaultGoal ?? CAMPAIGN_BUNDLES.en.defaultGoal ?? 'Land intact — anywhere survivable.';
}
