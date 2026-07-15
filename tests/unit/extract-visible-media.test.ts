import { describe, expect, it } from 'vitest';
import { extractVisibleDiscordMedia } from '../../src/extractors/discord/extract-visible-media';
import fixture from '../fixtures/discord-channel.html?raw';

describe('extractVisibleDiscordMedia', () => {
  it('extracts visible Discord attachments, deduplicates them, and excludes offscreen media', () => {
    document.write(fixture);
    window.location.href = 'https://discord.com/channels/100/200';
    setWindowSize(1024, 768);
    setRect(requireElement('message-viewport'), rect(0, 0, 900, 700));
    setRect(requireElement('visible-image').querySelector('img')!, rect(20, 20, 200, 160));
    setRect(requireElement('visible-video').querySelector('video')!, rect(20, 200, 240, 180));
    setRect(requireElement('visible-file'), rect(20, 410, 300, 40));
    setRect(requireElement('duplicate-image'), rect(20, 470, 300, 40));
    setRect(requireElement('offscreen-image'), rect(20, 900, 300, 40));
    setRect(requireElement('external-link'), rect(20, 520, 300, 40));

    const result = extractVisibleDiscordMedia(document, window);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual([
      'image',
      'video',
      'file',
    ]);
    expect(result.candidates.map((candidate) => candidate.suggestedFilename)).toEqual([
      'photo.png',
      'movie.mp4',
      'notes.pdf',
    ]);
  });

  it('fails closed when the message viewport cannot be found', () => {
    document.body.replaceChildren(document.createElement('main'));
    window.location.href = 'https://discord.com/channels/100/200';

    expect(extractVisibleDiscordMedia(document, window)).toMatchObject({
      ok: false,
      code: 'MESSAGE_VIEWPORT_NOT_FOUND',
    });
  });
});

function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
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

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Fixture element not found: ${id}`);
  return element;
}
