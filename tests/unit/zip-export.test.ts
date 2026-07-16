import { describe, expect, it } from 'vitest';
import { stableCandidateId } from '../../src/domain/id';
import type { MediaCandidate } from '../../src/domain/media';
import { createZipArchiveFilename, prepareZipEntries } from '../../src/domain/zip-export';

describe('ZIP export domain', () => {
  it('creates safe case-insensitive unique entry names while preserving extensions', () => {
    const entries = prepareZipEntries([
      createCandidate(1, 'photo.png'),
      createCandidate(2, 'PHOTO.png'),
      createCandidate(3, 'photo.png'),
    ]);

    expect(entries.map((entry) => entry.filename)).toEqual([
      'photo.png',
      'PHOTO (2).png',
      'photo (3).png',
    ]);
  });

  it('keeps unique filenames within the 180 character limit', () => {
    const filename = `${'a'.repeat(175)}.png`;
    const entries = prepareZipEntries([createCandidate(1, filename), createCandidate(2, filename)]);

    expect(entries[1]?.filename).toHaveLength(180);
    expect(entries[1]?.filename.endsWith(' (2).png')).toBe(true);
  });

  it('rejects an empty selection and accepts all 500 collected candidates', () => {
    expect(() => prepareZipEntries([])).toThrow('選択');
    expect(
      prepareZipEntries(
        Array.from({ length: 500 }, (_, index) => createCandidate(index, `file-${index}.png`)),
      ),
    ).toHaveLength(500);
  });

  it('creates a channel-name-free archive filename in local time', () => {
    const date = new Date(2026, 6, 15, 9, 8, 7);
    expect(createZipArchiveFilename(date)).toBe('discord-media-20260715-090807.zip');
  });
});

function createCandidate(index: number, filename: string): MediaCandidate {
  const pathname = `/attachments/111/${200 + index}/${encodeURIComponent(filename)}`;
  return {
    id: stableCandidateId(pathname),
    sourceUrl: `https://cdn.discordapp.com${pathname}`,
    kind: 'image',
    displayName: filename,
    suggestedFilename: filename,
    source: 'image',
  };
}
