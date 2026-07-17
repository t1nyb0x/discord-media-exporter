import type { UserFacingError } from '../domain/errors';
import { catalogs, type GeneratedLocale, type GeneratedTranslationKey } from './generated-i18n';

export { catalogs };
export type SupportedLocale = GeneratedLocale;
export type TranslationKey = GeneratedTranslationKey;
export type LocalePreference = 'auto' | SupportedLocale;
export type TranslationParams = Record<string, string | number>;

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'auto' || value === 'ja' || value === 'en';
}

export function resolveLocale(
  preference: LocalePreference,
  chromeLanguage: string,
): SupportedLocale {
  if (preference !== 'auto') return preference;
  return chromeLanguage.toLowerCase().split(/[-_]/)[0] === 'ja' ? 'ja' : 'en';
}

export interface Translator {
  readonly locale: SupportedLocale;
  t(key: TranslationKey, params?: TranslationParams): string;
  number(value: number): string;
  bytes(value: number): string;
  error(error: UserFacingError): string;
}

export function createTranslator(
  locale: SupportedLocale,
  warn: (message: string) => void = console.warn,
): Translator {
  const t = (key: TranslationKey, params: TranslationParams = {}): string => {
    const template = catalogs[locale][key] ?? catalogs.en[key];
    if (template === undefined) {
      warn(`Missing translation: ${key}`);
      return `[${key}]`;
    }
    const required = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map(
      (match) => match[1]!,
    );
    if (required.some((name) => !(name in params))) {
      warn(`Missing translation parameter: ${key}`);
      return `[${key}]`;
    }
    return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, name: string) =>
      String(params[name]),
    );
  };
  return {
    locale,
    t,
    number: (value) => new Intl.NumberFormat(locale).format(value),
    bytes: (value) => formatBytes(value, locale),
    error: (error) => {
      const params: TranslationParams = { ...(error.params ?? {}) };
      if ('filename' in params)
        params.filename = locale === 'ja' ? `「${params.filename}」` : `“${params.filename}”`;
      else params.filename = '';
      if ('reason' in params) params.reason = ` (${params.reason})`;
      else params.reason = '';
      return t(`error_${error.code}` as TranslationKey, params);
    },
  };
}

function formatBytes(bytes: number, locale: SupportedLocale): string {
  const safe = Math.max(0, bytes);
  if (safe < 1024) return `${new Intl.NumberFormat(locale).format(safe)} B`;
  const value = safe < 1024 * 1024 ? safe / 1024 : safe / (1024 * 1024);
  const unit = safe < 1024 * 1024 ? 'KiB' : 'MiB';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value)} ${unit}`;
}
