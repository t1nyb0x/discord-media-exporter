import { describe, expect, it } from 'vitest';
import { stableCandidateId } from '../../src/domain/id';
import { isValidMediaCandidate } from '../../src/domain/validation';

describe('isValidMediaCandidate', () => {
  const sourceUrl = 'https://cdn.discordapp.com/attachments/111/222/photo.png?ex=abc';
  const identity = '/attachments/111/222/photo.png';

  it('accepts a candidate derived from its validated attachment URL', () => {
    expect(
      isValidMediaCandidate({
        id: stableCandidateId(identity),
        sourceUrl,
        kind: 'image',
        displayName: 'photo.png',
        suggestedFilename: 'photo.png',
        source: 'image',
      }),
    ).toBe(true);
  });

  it('rejects a candidate whose ID does not match the URL', () => {
    expect(
      isValidMediaCandidate({
        id: 'media-deadbeef',
        sourceUrl,
        kind: 'image',
        displayName: 'photo.png',
        suggestedFilename: 'photo.png',
        source: 'image',
      }),
    ).toBe(false);
  });

  it('rejects a filename that was not derived safely from the URL', () => {
    expect(
      isValidMediaCandidate({
        id: stableCandidateId(identity),
        sourceUrl,
        kind: 'image',
        displayName: 'photo.png',
        suggestedFilename: 'renamed.png',
        source: 'image',
      }),
    ).toBe(false);
  });
});
