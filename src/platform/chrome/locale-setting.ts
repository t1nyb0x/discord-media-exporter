import { browser } from 'wxt/browser';
import {
  isLocalePreference,
  resolveLocale,
  type LocalePreference,
  type SupportedLocale,
} from '../../shared/i18n';

export const LOCALE_PREFERENCE_KEY = 'localePreference';

/** Loads the device-local language override, defaulting safely to auto. */
export async function loadLocalePreference(): Promise<LocalePreference> {
  try {
    const stored = await browser.storage.local.get(LOCALE_PREFERENCE_KEY);
    const value = stored[LOCALE_PREFERENCE_KEY];
    return isLocalePreference(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

/** Stores a validated device-local language override. */
export async function saveLocalePreference(preference: LocalePreference): Promise<void> {
  if (!isLocalePreference(preference)) throw new TypeError('Invalid locale preference');
  await browser.storage.local.set({ [LOCALE_PREFERENCE_KEY]: preference });
}

/** Resolves the current override against Chrome's UI language. */
export async function loadResolvedLocale(): Promise<{
  preference: LocalePreference;
  locale: SupportedLocale;
}> {
  const preference = await loadLocalePreference();
  return { preference, locale: resolveLocale(preference, chromeUiLanguage()) };
}

export function chromeUiLanguage(): string {
  try {
    return browser.i18n.getUILanguage();
  } catch {
    // The Chrome extension runtime always exposes i18n; this fallback mainly supports unit DOMs.
    return 'ja';
  }
}
