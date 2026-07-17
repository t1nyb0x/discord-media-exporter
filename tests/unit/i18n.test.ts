import { describe, expect, it, vi } from 'vitest';
import { catalogs, createTranslator, resolveLocale } from '../../src/shared/i18n';
import { isUserFacingError } from '../../src/domain/errors';
import { discordSpoilerLabelTerms } from '../../src/shared/generated-i18n';

describe('i18n', () => {
  it('resolves Japanese variants and falls unsupported languages back to English', () => {
    expect(resolveLocale('auto', 'ja')).toBe('ja');
    expect(resolveLocale('auto', 'ja-JP')).toBe('ja');
    expect(resolveLocale('auto', 'en-US')).toBe('en');
    expect(resolveLocale('auto', 'fr')).toBe('en');
    expect(resolveLocale('ja', 'en-US')).toBe('ja');
    expect(resolveLocale('en', 'ja-JP')).toBe('en');
  });

  it('keeps catalog keys and placeholders aligned', () => {
    expect(Object.keys(catalogs.ja).sort()).toEqual(Object.keys(catalogs.en).sort());
    for (const key of Object.keys(catalogs.en) as Array<keyof typeof catalogs.en>) {
      expect(placeholders(catalogs.ja[key]), key).toEqual(placeholders(catalogs.en[key]));
    }
  });

  it('makes missing replacement values detectable and formats errors safely', () => {
    const warn = vi.fn();
    const translator = createTranslator('en', warn);
    expect(translator.t('count')).toBe('[count]');
    expect(warn).toHaveBeenCalledOnce();
    expect(translator.error({ code: 'FETCH_FAILED', params: { filename: '<img>' } })).toContain(
      '“<img>”',
    );
  });

  it('rejects unknown codes, params, locales, and unsafe replacement values', () => {
    expect(isUserFacingError({ code: 'UNKNOWN' })).toBe(false);
    expect(isUserFacingError({ code: 'FETCH_FAILED', params: { url: 'secret' } })).toBe(false);
    expect(isUserFacingError({ code: 'FETCH_FAILED', params: { filename: '<b>x</b>' } })).toBe(
      true,
    );
  });

  it('generates the Discord spoiler detector lexicon from every locale', () => {
    expect(discordSpoilerLabelTerms).toEqual(['spoiler', 'スポイラー', 'ネタバレ']);
  });
});

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]!).sort();
}
