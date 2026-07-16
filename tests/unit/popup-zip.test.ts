import { afterEach, describe, expect, it, vi } from 'vitest';
import popupFixture from '../../entrypoints/popup/index.html?raw';
import { stableCandidateId } from '../../src/domain/id';

const candidateUrl = 'https://cdn.discordapp.com/attachments/111/222/photo.png';
const channelScope = 'https://discord.com/channels/100/200';
const candidate = {
  id: stableCandidateId('/attachments/111/222/photo.png'),
  sourceUrl: candidateUrl,
  kind: 'image',
  displayName: 'photo.png',
  suggestedFilename: 'photo.png',
  source: 'image',
};

const browserMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendTabMessage: vi.fn(),
  queryTabs: vi.fn(),
  executeScript: vi.fn(),
  requestPermission: vi.fn(),
  removePermission: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: browserMocks.sendMessage },
    tabs: { query: browserMocks.queryTabs, sendMessage: browserMocks.sendTabMessage },
    scripting: { executeScript: browserMocks.executeScript },
    permissions: {
      request: browserMocks.requestPermission,
      remove: browserMocks.removePermission,
    },
  },
}));

describe('popup ZIP export', () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: originalStorage });
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('requests optional CDN access from the ZIP click and starts selected entries', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn(async () => ({
          usage: 2 * 1024 * 1024,
          quota: 10 * 1024 * 1024,
        })),
      },
    });
    browserMocks.queryTabs.mockResolvedValue([{ id: 1, url: channelScope }]);
    browserMocks.executeScript.mockResolvedValue([
      { result: { ok: true, scope: channelScope, candidates: [candidate] } },
    ]);
    browserMocks.sendTabMessage.mockResolvedValue({ active: false });
    browserMocks.requestPermission.mockResolvedValue(true);
    browserMocks.removePermission.mockResolvedValue(true);
    browserMocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      switch (request.type) {
        case 'REGISTER_SCAN_RESULT':
          return {
            ok: true,
            type: 'SCAN_REGISTERED',
            collection: { scope: channelScope, candidates: [candidate] },
          };
        case 'GET_SCAN_COLLECTION':
          return {
            ok: true,
            type: 'SCAN_COLLECTION',
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
        case 'START_ZIP_EXPORT':
          return {
            ok: true,
            type: 'ZIP_EXPORT_STARTED',
            state: {
              status: 'fetching',
              jobId: 'job-1',
              archiveFilename: 'discord-media-20260715-120000.zip',
              totalItems: 1,
              completedItems: 0,
              processedBytes: 0,
              currentFilename: 'photo.png',
            },
          };
        default:
          return { ok: false, error: 'unexpected' };
      }
    });
    loadPopupFixture();
    await import('../../entrypoints/popup/main');
    await flushPromises();

    document.getElementById('scan-button')?.click();
    await flushPromises();
    const checkbox = document.querySelector<HTMLInputElement>('#candidate-list input');
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event('change'));

    document.getElementById('zip-button')?.click();
    await flushPromises();

    expect(browserMocks.requestPermission).toHaveBeenCalledWith({
      origins: ['https://cdn.discordapp.com/*', 'https://media.discordapp.net/*'],
    });
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      type: 'START_ZIP_EXPORT',
      candidateIds: [candidate.id],
    });
    expect(document.getElementById('zip-progress')?.hidden).toBe(false);
    expect(document.getElementById('zip-progress-summary')?.textContent).toContain('取得中');
    expect(document.getElementById('notice')?.textContent).toContain('8.0 MiB');
  });
});

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function loadPopupFixture(): void {
  document.open();
  document.write(popupFixture);
  document.close();
}
