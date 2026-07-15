import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '../../src/domain/media';
import { VisibleMediaCollector } from '../../src/extractors/discord/visible-media-collector';
import fixture from '../fixtures/discord-channel.html?raw';

type SuccessfulScanResult = Extract<ScanResult, { ok: true }>;

describe('VisibleMediaCollector', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes newly visible media after a manual scroll without another popup action', async () => {
    vi.useFakeTimers();
    prepareFixture();
    const published: SuccessfulScanResult[] = [];
    const collector = new VisibleMediaCollector(document, window, (result) => {
      published.push(result);
    });

    const initial = collector.start();
    expect(initial).toMatchObject({ ok: true, candidates: expect.any(Array) });
    expect(collector.isActive()).toBe(true);

    setRect(requireElement('visible-image').querySelector('img')!, rect(20, -300, 200, 160));
    setRect(requireElement('offscreen-image'), rect(20, 500, 300, 40));
    document.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(250);

    expect(published).toHaveLength(1);
    expect(published[0]!.candidates.map((candidate) => candidate.suggestedFilename)).toContain(
      'offscreen.png',
    );

    collector.stop();
    setRect(requireElement('visible-file'), rect(20, -300, 300, 40));
    document.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(250);
    expect(published).toHaveLength(1);
  });

  it('stops automatically when Discord changes to another channel', async () => {
    vi.useFakeTimers();
    prepareFixture();
    const publish = vi.fn();
    const collector = new VisibleMediaCollector(document, window, publish);
    collector.start();

    window.location.href = 'https://discord.com/channels/100/300';
    document.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(250);

    expect(collector.isActive()).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('retries a changed visible range after a temporary publish failure', async () => {
    vi.useFakeTimers();
    prepareFixture();
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const collector = new VisibleMediaCollector(document, window, publish);
    collector.start();

    setRect(requireElement('offscreen-image'), rect(20, 500, 300, 40));
    document.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(250);
    document.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(250);

    expect(publish).toHaveBeenCalledTimes(2);
  });
});

function prepareFixture(): void {
  document.open();
  document.write(fixture);
  document.close();
  window.location.href = 'https://discord.com/channels/100/200';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  setRect(requireElement('message-viewport'), rect(0, 0, 900, 700));
  setRect(requireElement('visible-image').querySelector('img')!, rect(20, 20, 200, 160));
  setRect(requireElement('visible-video').querySelector('video')!, rect(20, 200, 240, 180));
  setRect(requireElement('second-visible-image').querySelector('img')!, rect(280, 200, 240, 180));
  setRect(requireElement('visible-file'), rect(20, 410, 300, 40));
  setRect(requireElement('duplicate-image'), rect(20, 470, 300, 40));
  setRect(requireElement('offscreen-image'), rect(20, 900, 300, 40));
  setRect(requireElement('hidden-image'), rect(20, 540, 300, 40));
  setRect(requireElement('external-link'), rect(20, 520, 300, 40));
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
