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
  requestPermission: vi.fn(),
  localePreference: 'auto',
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: browserMocks.sendMessage },
    tabs: { query: browserMocks.queryTabs, sendMessage: browserMocks.sendTabMessage },
    scripting: { executeScript: browserMocks.executeScript },
    permissions: { request: browserMocks.requestPermission, remove: vi.fn() },
    i18n: { getUILanguage: () => 'ja-JP' },
    storage: {
      local: {
        get: vi.fn(async () => ({ localePreference: browserMocks.localePreference })),
        set: vi.fn(async (values: { localePreference?: string }) => {
          if (values.localePreference !== undefined)
            browserMocks.localePreference = values.localePreference;
        }),
      },
    },
  },
}));

describe('popup scan collection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    browserMocks.localePreference = 'auto';
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('restores a session collection, starts automatic collection, and allows it to stop', async () => {
    vi.useFakeTimers();
    browserMocks.queryTabs.mockResolvedValue([{ id: 1, url: scope }]);
    browserMocks.executeScript.mockResolvedValue([{ result: { active: false } }]);
    browserMocks.sendTabMessage.mockImplementation(
      async (_tabId: number, request: { type: string }) => {
        switch (request.type) {
          case 'GET_MEDIA_COLLECTOR_STATUS':
            return { type: 'MEDIA_COLLECTOR_STATUS', active: false };
          case 'START_MEDIA_COLLECTOR':
            return {
              type: 'MEDIA_COLLECTOR_STARTED',
              active: true,
              collection: { scope, candidates: [firstCandidate, secondCandidate] },
              visibleCandidateCount: 1,
            };
          case 'SET_MEDIA_COLLECTOR_COUNT':
            return { type: 'MEDIA_COLLECTOR_STATUS', active: true };
          case 'STOP_MEDIA_COLLECTOR':
            return { type: 'MEDIA_COLLECTOR_STATUS', active: false };
          default:
            throw new Error('unexpected tab request');
        }
      },
    );
    browserMocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      switch (request.type) {
        case 'GET_SCAN_COLLECTION':
          return {
            ok: true,
            type: 'SCAN_COLLECTION',
            collection: { scope, candidates: [firstCandidate] },
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

    expect(browserMocks.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['scan.js'],
    });
    expect(browserMocks.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REGISTER_SCAN_RESULT' }),
    );
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

    expect(browserMocks.sendTabMessage).toHaveBeenCalledWith(1, {
      type: 'START_MEDIA_COLLECTOR',
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
      async (_tabId: number, request: { type: string }) =>
        request.type === 'GET_MEDIA_COLLECTOR_STATUS'
          ? { type: 'MEDIA_COLLECTOR_STATUS', active: true }
          : { type: 'MEDIA_COLLECTOR_STATUS', active: false },
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
    expect(browserMocks.executeScript).toHaveBeenCalledOnce();
    expect(document.getElementById('scan-button')?.textContent).toBe('自動収集を開始');
  });

  it('enables and disables automatic launcher display from explicit permission actions', async () => {
    vi.useFakeTimers();
    browserMocks.queryTabs.mockResolvedValue([{ id: 1, url: scope }]);
    browserMocks.executeScript.mockResolvedValue([{ result: { active: false } }]);
    browserMocks.sendTabMessage.mockResolvedValue({
      type: 'MEDIA_COLLECTOR_STATUS',
      active: false,
    });
    browserMocks.requestPermission.mockResolvedValue(true);
    browserMocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      switch (request.type) {
        case 'GET_SCAN_COLLECTION':
          return {
            ok: true,
            type: 'SCAN_COLLECTION',
            collection: { scope, candidates: [] },
          };
        case 'GET_DISCORD_LAUNCHER_SETTING':
          return { ok: true, type: 'DISCORD_LAUNCHER_SETTING', enabled: false };
        case 'SYNC_DISCORD_LAUNCHER_SETTING':
          return { ok: true, type: 'DISCORD_LAUNCHER_SETTING', enabled: true };
        case 'DISABLE_DISCORD_LAUNCHER_SETTING':
          return { ok: true, type: 'DISCORD_LAUNCHER_SETTING', enabled: false };
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

    const toggle = document.getElementById('launcher-setting-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await flushPromises();

    expect(browserMocks.requestPermission).toHaveBeenCalledWith({
      origins: ['https://discord.com/*'],
    });
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: 'SYNC_DISCORD_LAUNCHER_SETTING',
    });
    expect(toggle.checked).toBe(true);
    expect(document.getElementById('launcher-setting-status')?.textContent).toContain('ON');

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await flushPromises();

    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: 'DISABLE_DISCORD_LAUNCHER_SETTING',
    });
    expect(toggle.checked).toBe(false);
    expect(document.getElementById('launcher-setting-status')?.textContent).toContain('OFF');

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await flushPromises();

    expect(toggle.checked).toBe(true);
    expect(browserMocks.executeScript).toHaveBeenLastCalledWith({
      target: { tabId: 1 },
      files: ['scan.js'],
    });
    expect(browserMocks.executeScript).toHaveBeenCalledTimes(3);
  });

  it('switches the popup language immediately without losing collection state', async () => {
    vi.useFakeTimers();
    browserMocks.queryTabs.mockResolvedValue([{ id: 1, url: scope }]);
    browserMocks.sendTabMessage.mockResolvedValue({
      type: 'MEDIA_COLLECTOR_STATUS',
      active: false,
    });
    browserMocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'GET_SCAN_COLLECTION') {
        return {
          ok: true,
          type: 'SCAN_COLLECTION',
          collection: { scope, candidates: [firstCandidate] },
        };
      }
      if (request.type === 'GET_DISCORD_LAUNCHER_SETTING') {
        return { ok: true, type: 'DISCORD_LAUNCHER_SETTING', enabled: false };
      }
      if (request.type === 'GET_DOWNLOAD_STATUS')
        return { ok: true, type: 'DOWNLOAD_STATUS', state: { items: [] } };
      return {
        ok: true,
        type: 'ZIP_EXPORT_STATUS',
        state: { status: 'idle', totalItems: 0, completedItems: 0, processedBytes: 0 },
      };
    });

    loadPopupFixture();
    await import('../../entrypoints/popup/main');
    await flushPromises();
    const select = document.getElementById('language-select') as HTMLSelectElement;
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    await flushPromises();

    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('h1')?.textContent).toBe('Visible media');
    expect(document.getElementById('candidate-count')?.textContent).toBe('1');
    expect(document.querySelectorAll('#candidate-list li')).toHaveLength(1);
    expect(document.getElementById('notice')?.textContent).toContain('Restored 1');
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
