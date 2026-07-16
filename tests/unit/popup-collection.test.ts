import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import popupFixture from '../../entrypoints/popup/index.html?raw';
import { stableCandidateId } from '../../src/domain/id';
import type { MediaCandidate } from '../../src/domain/media';

const scope = 'https://discord.com/channels/100/200';
const firstCandidate = createCandidate(1);
const secondCandidate = createCandidate(2);

const browserMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendTabMessage: vi.fn(),
  queryTabs: vi.fn(),
  executeScript: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: browserMocks.sendMessage },
    tabs: { query: browserMocks.queryTabs, sendMessage: browserMocks.sendTabMessage },
    scripting: { executeScript: browserMocks.executeScript },
    permissions: { request: vi.fn(), remove: vi.fn() },
  },
}));

describe('popup scan collection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('restores a session collection, starts automatic collection, and allows it to stop', async () => {
    vi.useFakeTimers();
    browserMocks.queryTabs.mockResolvedValue([{ id: 1, url: scope }]);
    browserMocks.executeScript.mockResolvedValue([
      { result: { ok: true, scope, candidates: [secondCandidate] } },
    ]);
    browserMocks.sendTabMessage.mockResolvedValue({ active: false });
    browserMocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      switch (request.type) {
        case 'GET_SCAN_COLLECTION':
          return {
            ok: true,
            type: 'SCAN_COLLECTION',
            collection: { scope, candidates: [firstCandidate] },
          };
        case 'REGISTER_SCAN_RESULT':
          return {
            ok: true,
            type: 'SCAN_REGISTERED',
            collection: { scope, candidates: [firstCandidate, secondCandidate] },
          };
        case 'CLEAR_SCAN_COLLECTION':
          return {
            ok: true,
            type: 'SCAN_COLLECTION_CLEARED',
            collection: { scope: null, candidates: [] },
          };
        case 'GET_DOWNLOAD_STATUS':
          return { ok: true, type: 'DOWNLOAD_STATUS', state: { items: [] } };
        case 'GET_EXPORT_STATUS':
          return {
            ok: true,
            type: 'ZIP_EXPORT_STATUS',
            state: {
              status: 'idle',
              totalItems: 0,
              completedItems: 0,
              processedBytes: 0,
            },
          };
        default:
          return { ok: false, error: 'unexpected' };
      }
    });

    loadPopupFixture();
    await import('../../entrypoints/popup/main');
    await flushPromises();

    expect(document.querySelectorAll('#candidate-list li')).toHaveLength(1);
    const thumbnail = document.querySelector<HTMLImageElement>('.media-thumbnail');
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.src).toBe(
      'https://media.discordapp.net/attachments/111/201/file-1.png?width=80&height=80',
    );
    expect(thumbnail?.loading).toBe('lazy');
    expect(thumbnail?.decoding).toBe('async');
    expect(thumbnail?.referrerPolicy).toBe('no-referrer');
    expect(thumbnail?.classList.contains('media-thumbnail-loading')).toBe(true);
    thumbnail?.dispatchEvent(new Event('load'));
    expect(thumbnail?.classList.contains('media-thumbnail-loading')).toBe(false);
    thumbnail?.dispatchEvent(new Event('error'));
    expect(document.querySelector('.media-thumbnail')).toBeNull();
    expect(document.querySelector('.media-icon-image')?.textContent).toBe('画');
    expect(document.getElementById('notice')?.textContent).toContain('1件の収集結果を復元');

    document.getElementById('scan-button')?.click();
    await flushPromises();

    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: 'REGISTER_SCAN_RESULT',
      scope,
      candidates: [secondCandidate],
    });
    expect(document.querySelectorAll('#candidate-list li')).toHaveLength(2);
    expect(document.getElementById('candidate-count')?.textContent).toBe('2件');
    expect(document.getElementById('notice')?.textContent).toContain('1件を追加');
    expect(browserMocks.sendTabMessage).toHaveBeenCalledWith(1, {
      type: 'SET_MEDIA_COLLECTOR_COUNT',
      count: 2,
    });

    document.getElementById('scan-button')?.click();
    await flushPromises();

    expect(browserMocks.sendTabMessage).toHaveBeenCalledWith(1, {
      type: 'STOP_MEDIA_COLLECTOR',
    });
    expect(document.getElementById('scan-button')?.textContent).toBe('自動収集を開始');

    document.getElementById('clear-collection-button')?.click();
    await flushPromises();

    expect(browserMocks.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_SCAN_COLLECTION', scope });
    expect(document.getElementById('results')?.hidden).toBe(true);
    expect(document.getElementById('candidate-count')?.textContent).toBe('0件');
  });

  it('restores the active collector state when the popup is reopened later', async () => {
    vi.useFakeTimers();
    browserMocks.queryTabs.mockResolvedValue([{ id: 1, url: scope }]);
    browserMocks.sendTabMessage.mockImplementation(
      async (_tabId: number, request: { type: string }) => ({
        active: request.type === 'GET_MEDIA_COLLECTOR_STATUS',
      }),
    );
    browserMocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      switch (request.type) {
        case 'GET_SCAN_COLLECTION':
          return {
            ok: true,
            type: 'SCAN_COLLECTION',
            collection: { scope, candidates: [firstCandidate] },
          };
        case 'GET_DOWNLOAD_STATUS':
          return { ok: true, type: 'DOWNLOAD_STATUS', state: { items: [] } };
        case 'GET_EXPORT_STATUS':
          return {
            ok: true,
            type: 'ZIP_EXPORT_STATUS',
            state: {
              status: 'idle',
              totalItems: 0,
              completedItems: 0,
              processedBytes: 0,
            },
          };
        default:
          return { ok: false, error: 'unexpected' };
      }
    });

    loadPopupFixture();
    await import('../../entrypoints/popup/main');
    await flushPromises();

    expect(document.getElementById('scan-button')?.textContent).toBe('自動収集を停止');

    document.getElementById('scan-button')?.click();
    await flushPromises();

    expect(browserMocks.sendTabMessage).toHaveBeenCalledWith(1, {
      type: 'STOP_MEDIA_COLLECTOR',
    });
    expect(browserMocks.executeScript).not.toHaveBeenCalled();
    expect(document.getElementById('scan-button')?.textContent).toBe('自動収集を開始');
  });
});

function createCandidate(index: number): MediaCandidate {
  const pathname = `/attachments/111/${200 + index}/file-${index}.png`;
  return {
    id: stableCandidateId(pathname),
    sourceUrl: `https://cdn.discordapp.com${pathname}`,
    kind: 'image',
    displayName: `file-${index}.png`,
    suggestedFilename: `file-${index}.png`,
    source: 'image',
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function loadPopupFixture(): void {
  document.open();
  document.write(popupFixture);
  document.close();
}
