import { describe, expect, it } from 'vitest';
import { filenameFromUrl, sanitizeFilename } from '../../src/domain/filename';

describe('sanitizeFilename', () => {
  it('removes path traversal and reserved characters', () => {
    expect(sanitizeFilename('../bad/name:?.png')).toBe('__bad_name__.png');
  });

  it('avoids Windows reserved names', () => {
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
  });

  it('preserves the extension when truncating long names', () => {
    const result = sanitizeFilename(`${'a'.repeat(240)}.webp`);
    expect(result).toHaveLength(180);
    expect(result.endsWith('.webp')).toBe(true);
  });

  it('decodes a filename from the URL path', () => {
    const url = new URL('https://cdn.discordapp.com/attachments/1/2/%E7%94%BB%E5%83%8F.png');
    expect(filenameFromUrl(url)).toBe('画像.png');
  });
});
