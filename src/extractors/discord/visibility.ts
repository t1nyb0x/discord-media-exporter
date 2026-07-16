export interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

/** Returns the positive-area intersection of two rectangles. */
export function intersectRects(first: RectLike, second: RectLike): RectLike | null {
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  const left = Math.max(first.left, second.left);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) return null;
  return { top, right, bottom, left, width, height };
}

/** Reports whether an element is rendered and intersects the supplied viewport. */
export function isElementVisibleInRect(
  element: Element,
  viewport: RectLike,
  windowObject: Window,
): boolean {
  const style = windowObject.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse'
  ) {
    return false;
  }
  if (Number.parseFloat(style.opacity || '1') === 0) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return intersectRects(rect, viewport) !== null;
}
