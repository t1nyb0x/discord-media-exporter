import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GuidedCollectionControls,
  revealVisibleSpoilers,
  scrollOnePageBackward,
  scrollOnePageForward,
} from '../../src/extractors/discord/guided-scroll';
import { findMessageScrollContainer } from '../../src/extractors/discord/message-viewport';

describe('guided scroll collection', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('finds the scrollable ancestor and moves exactly one user-requested page backward', () => {
    const container = prepareScrollableMessages(1_600);
    const onScroll = vi.fn();
    container.addEventListener('scroll', onScroll);

    expect(findMessageScrollContainer(document, window)).toBe(container);
    expect(scrollOnePageBackward(document, window)).toEqual({
      status: 'moved',
      reachedStart: false,
    });
    expect(container.scrollTop).toBe(1_040);
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it('reports the start without creating an automatic scroll loop', () => {
    const container = prepareScrollableMessages(0);
    const onScroll = vi.fn();
    container.addEventListener('scroll', onScroll);

    expect(scrollOnePageBackward(document, window)).toEqual({ status: 'at_start' });
    expect(container.scrollTop).toBe(0);
    expect(onScroll).not.toHaveBeenCalled();
  });

  it('moves exactly one user-requested page forward and stops at the end', () => {
    const container = prepareScrollableMessages(1_600);
    const onScroll = vi.fn();
    container.addEventListener('scroll', onScroll);

    expect(scrollOnePageForward(document, window)).toEqual({
      status: 'moved',
      reachedEnd: false,
    });
    expect(container.scrollTop).toBe(2_160);
    expect(onScroll).toHaveBeenCalledOnce();

    container.scrollTop = 3_200;
    expect(scrollOnePageForward(document, window)).toEqual({
      status: 'moved',
      reachedEnd: true,
    });
    expect(container.scrollTop).toBe(3_300);
    expect(onScroll).toHaveBeenCalledTimes(2);

    expect(scrollOnePageForward(document, window)).toEqual({ status: 'at_end' });
    expect(onScroll).toHaveBeenCalledTimes(2);
  });

  it('runs one step per explicit direction button click and stops from the page control', () => {
    const onStepBackward = vi.fn(() => ({ status: 'moved' as const, reachedStart: false }));
    const onStepForward = vi.fn(() => ({ status: 'moved' as const, reachedEnd: false }));
    const onRevealSpoilers = vi.fn(() => ({ revealed: 2, failed: 0 }));
    const onStop = vi.fn();
    const controls = new GuidedCollectionControls(document, {
      onStepBackward,
      onStepForward,
      onRevealSpoilers,
      onStop,
    });
    const host = document.getElementById('discord-media-exporter-guided-controls')!;
    const buttons = host.shadowRoot!.querySelectorAll<HTMLButtonElement>('button');

    buttons[0]!.click();
    expect(onStepBackward).toHaveBeenCalledOnce();
    expect(host.shadowRoot!.textContent).toContain('1画面戻りました');

    buttons[1]!.click();
    expect(onStepForward).toHaveBeenCalledOnce();
    expect(host.shadowRoot!.textContent).toContain('1画面進みました');

    buttons[2]!.click();
    expect(onRevealSpoilers).toHaveBeenCalledOnce();
    expect(host.shadowRoot!.textContent).toContain('2件のスポイラー');

    buttons[3]!.click();
    expect(onStop).toHaveBeenCalledOnce();

    controls.setCollectedCount(500);
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(true);
    expect(host.shadowRoot!.textContent).toContain('500件');
    controls.setCollectedCount(10);
    expect(buttons[0]!.disabled).toBe(false);
    expect(buttons[1]!.disabled).toBe(false);
    controls.remove();
    expect(document.getElementById('discord-media-exporter-guided-controls')).toBeNull();
  });

  it('reports upper and lower boundaries without starting another scroll', () => {
    const controls = new GuidedCollectionControls(document, {
      onStepBackward: () => ({ status: 'at_start' }),
      onStepForward: () => ({ status: 'at_end' }),
      onRevealSpoilers: () => ({ revealed: 0, failed: 0 }),
      onStop: vi.fn(),
    });
    const host = document.getElementById('discord-media-exporter-guided-controls')!;
    const buttons = host.shadowRoot!.querySelectorAll<HTMLButtonElement>('button');

    buttons[0]!.click();
    expect(host.shadowRoot!.textContent).toContain('現在は上端');

    buttons[1]!.click();
    expect(host.shadowRoot!.textContent).toContain('現在は下端');

    controls.remove();
  });

  it('fails safely when the message scroll container is unavailable', () => {
    document.body.replaceChildren(document.createElement('main'));
    expect(scrollOnePageBackward(document, window)).toEqual({ status: 'unavailable' });
    expect(scrollOnePageForward(document, window)).toEqual({ status: 'unavailable' });
  });

  it('reveals only visible labelled spoiler controls and caps one action at 50', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    document.body.innerHTML = '<main><ol data-list-id="chat-messages"></ol></main>';
    const viewport = document.querySelector('ol')!;
    setRect(viewport, rect(0, 0, 900, 700));
    const clicks = Array.from({ length: 52 }, (_, index) => {
      const button = document.createElement('button');
      button.setAttribute(
        'aria-label',
        index % 3 === 0 ? 'Show Spoiler' : index % 3 === 1 ? 'スポイラーを表示' : 'ネタバレ',
      );
      button.setAttribute('aria-expanded', 'false');
      const click = vi.fn();
      button.addEventListener('click', click);
      setRect(button, rect(20, 20 + (index % 10) * 40, 180, 32));
      viewport.append(button);
      return click;
    });
    const offscreen = document.createElement('button');
    offscreen.setAttribute('aria-label', 'Show Spoiler');
    const offscreenClick = vi.fn();
    offscreen.addEventListener('click', offscreenClick);
    setRect(offscreen, rect(20, 900, 180, 32));
    viewport.append(offscreen);
    const unrelated = document.createElement('button');
    unrelated.setAttribute('aria-label', 'リアクションを追加');
    const unrelatedClick = vi.fn();
    unrelated.addEventListener('click', unrelatedClick);
    setRect(unrelated, rect(20, 40, 180, 32));
    viewport.append(unrelated);
    const disabled = document.createElement('button');
    disabled.disabled = true;
    disabled.setAttribute('aria-label', 'Show Spoiler');
    const disabledClick = vi.fn();
    disabled.addEventListener('click', disabledClick);
    setRect(disabled, rect(20, 80, 180, 32));
    viewport.append(disabled);
    const alreadyRevealed = document.createElement('div');
    alreadyRevealed.setAttribute('role', 'button');
    alreadyRevealed.setAttribute('aria-label', 'ネタバレ');
    alreadyRevealed.setAttribute('aria-expanded', 'true');
    const alreadyRevealedClick = vi.fn();
    alreadyRevealed.addEventListener('click', alreadyRevealedClick);
    setRect(alreadyRevealed, rect(20, 120, 180, 32));
    viewport.append(alreadyRevealed);

    expect(revealVisibleSpoilers(document, window)).toEqual({ revealed: 50, failed: 0 });
    expect(clicks.filter((click) => click.mock.calls.length === 1)).toHaveLength(50);
    expect(offscreenClick).not.toHaveBeenCalled();
    expect(unrelatedClick).not.toHaveBeenCalled();
    expect(disabledClick).not.toHaveBeenCalled();
    expect(alreadyRevealedClick).not.toHaveBeenCalled();
  });
});

function prepareScrollableMessages(scrollTop: number): HTMLDivElement {
  document.body.innerHTML = `
    <main>
      <div id="scroller" style="overflow-y: auto">
        <ol data-list-id="chat-messages"></ol>
      </div>
    </main>
  `;
  const container = document.getElementById('scroller') as HTMLDivElement;
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 700 },
    scrollHeight: { configurable: true, value: 4_000 },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
  return container;
}

function setRect(element: Element, value: DOMRect): void {
  element.getBoundingClientRect = () => value;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height,
    toJSON: () => ({}),
  };
}
