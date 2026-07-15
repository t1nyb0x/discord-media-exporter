import { describe, expect, it } from 'vitest';
import { intersectRects } from '../../src/extractors/discord/visibility';

describe('intersectRects', () => {
  it('returns the overlapping rectangle', () => {
    expect(
      intersectRects(
        { top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100 },
        { top: 50, right: 150, bottom: 150, left: 50, width: 100, height: 100 },
      ),
    ).toEqual({ top: 50, right: 100, bottom: 100, left: 50, width: 50, height: 50 });
  });

  it('rejects rectangles that only touch', () => {
    expect(
      intersectRects(
        { top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100 },
        { top: 100, right: 100, bottom: 200, left: 0, width: 100, height: 100 },
      ),
    ).toBeNull();
  });
});
