import { describe, expect, it } from 'vitest';
import { extractVisibleDiscordMedia } from '../../src/extractors/discord/extract-visible-media';
import fixture from '../fixtures/discord-channel.html?raw';

describe('extractVisibleDiscordMedia', () => {
  it('extracts visible Discord attachments, deduplicates them, and excludes offscreen media', () => {
    loadFixture();
    window.location.href = 'https://discord.com/channels/100/200';
    setWindowSize(1024, 768);
    setRect(requireElement('message-viewport'), rect(0, 0, 900, 700));
    setRect(requireElement('visible-image').querySelector('img')!, rect(20, 20, 200, 160));
    setRect(requireElement('visible-video').querySelector('video')!, rect(20, 200, 240, 180));
    setRect(requireElement('second-visible-image').querySelector('img')!, rect(280, 200, 240, 180));
    setRect(requireElement('visible-file'), rect(20, 410, 300, 40));
    setRect(requireElement('duplicate-image'), rect(20, 470, 300, 40));
    setRect(requireElement('offscreen-image'), rect(20, 900, 300, 40));
    setRect(requireElement('hidden-image'), rect(20, 540, 300, 40));
    setRect(requireElement('external-link'), rect(20, 520, 300, 40));

    const result = extractVisibleDiscordMedia(document, window);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual([
      'image',
      'video',
      'image',
      'file',
    ]);
    expect(result.candidates.map((candidate) => candidate.suggestedFilename)).toEqual([
      'photo.png',
      'movie.mp4',
      'cover.webp',
      'notes.pdf',
    ]);
  });

  it('does not inspect the DOM outside a Discord channel page', () => {
    loadFixture();
    window.location.href = 'https://example.com/channels/100/200';

    expect(extractVisibleDiscordMedia(document, window)).toMatchObject({
      ok: false,
      code: 'NOT_DISCORD_CHANNEL',
    });
  });

  it('fails closed when the message viewport cannot be found', () => {
    document.body.replaceChildren(document.createElement('main'));
    window.location.href = 'https://discord.com/channels/100/200';

    expect(extractVisibleDiscordMedia(document, window)).toMatchObject({
      ok: false,
      code: 'MESSAGE_VIEWPORT_NOT_FOUND',
    });
  });

  it('supports the semantic role=log fallback without broadening the scan scope', () => {
    document.open();
    document.write(
      '<main><section role="log" id="message-log"><a id="fallback-file" href="https://cdn.discordapp.com/attachments/111/300/fallback.pdf">fallback.pdf</a></section></main>',
    );
    document.close();
    window.location.href = 'https://discord.com/channels/100/200';
    setWindowSize(1024, 768);
    setRect(requireElement('message-log'), rect(0, 0, 900, 700));
    setRect(requireElement('fallback-file'), rect(20, 20, 200, 30));

    const result = extractVisibleDiscordMedia(document, window);

    expect(result).toMatchObject({
      ok: true,
      candidates: [{ suggestedFilename: 'fallback.pdf', kind: 'file' }],
    });
  });

  it('normalizes up to 500 visible candidates within the performance budget', () => {
    document.open();
    document.write('<main><ol data-list-id="chat-messages" id="message-viewport"></ol></main>');
    document.close();
    window.location.href = 'https://discord.com/channels/100/200';
    setWindowSize(1024, 768);
    const viewport = requireElement('message-viewport');
    setRect(viewport, rect(0, 0, 900, 700));

    for (let index = 0; index < 500; index += 1) {
      const anchor = document.createElement('a');
      anchor.href = `https://cdn.discordapp.com/attachments/111/${1000 + index}/file-${index}.png`;
      anchor.textContent = `file-${index}.png`;
      setRect(anchor, rect(20, 20, 200, 30));
      viewport.append(anchor);
    }

    const startedAt = performance.now();
    const result = extractVisibleDiscordMedia(document, window);
    const duration = performance.now() - startedAt;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(500);
    expect(duration).toBeLessThan(1_000);
  });
});

function loadFixture(): void {
  document.open();
  document.write(fixture);
  document.close();
}

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
