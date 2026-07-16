const MESSAGE_VIEWPORT_SELECTORS = ['[data-list-id="chat-messages"]', 'main [role="log"]'] as const;

export function findMessageViewport(documentObject: Document): Element | null {
  for (const selector of MESSAGE_VIEWPORT_SELECTORS) {
    const element = documentObject.querySelector(selector);
    if (element !== null) return element;
  }
  return null;
}

export function findMessageScrollContainer(
  documentObject: Document,
  windowObject: Window,
): HTMLElement | null {
  const viewport = findMessageViewport(documentObject);
  if (viewport === null) return null;

  let fallback: HTMLElement | null = null;
  let current: Element | null = viewport;
  while (current !== null && current !== documentObject.body) {
    if (current instanceof HTMLElement && hasScrollableDimensions(current)) {
      fallback ??= current;
      if (hasScrollingOverflow(current, windowObject)) return current;
    }
    current = current.parentElement;
  }
  return fallback;
}

function hasScrollableDimensions(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight && element.clientHeight > 0;
}

function hasScrollingOverflow(element: HTMLElement, windowObject: Window): boolean {
  const overflowY = windowObject.getComputedStyle(element).overflowY;
  return ['auto', 'scroll', 'overlay'].includes(overflowY);
}
