import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaCandidate } from '../../src/domain/media';

const browserMocks = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  offscreenOpen: false,
  sendMessage: vi.fn(),
  createDocument: vi.fn(),
  closeDocument: vi.fn(),
  removePermissions: vi.fn(),
  download: vi.fn(),
  searchDownloads: vi.fn(),
  cancelDownload: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'test-extension-id',
      sendMessage: browserMocks.sendMessage,
      getContexts: vi.fn(async () =>
        browserMocks.offscreenOpen ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [],
      ),
    },
    offscreen: {
      createDocument: browserMocks.createDocument,
      closeDocument: browserMocks.closeDocument,
    },
    permissions: { remove: browserMocks.removePermissions },
    downloads: {
      download: browserMocks.download,
      search: browserMocks.searchDownloads,
      cancel: browserMocks.cancelDownload,
      onChanged: { addListener: vi.fn() },
    },
    storage: {
      session: {
        get: vi.fn(async () => ({ ...browserMocks.stored })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(browserMocks.stored, values);
        }),
      },
    },
  },
}));

describe('ChromeZipExportManager', () => {
  beforeEach(() => {
    vi.resetModules();
    browserMocks.stored = {};
    browserMocks.offscreenOpen = false;
    browserMocks.sendMessage.mockReset().mockResolvedValue({ accepted: true });
    browserMocks.createDocument.mockReset().mockImplementation(async () => {
      browserMocks.offscreenOpen = true;
    });
    browserMocks.closeDocument.mockReset().mockImplementation(async () => {
      browserMocks.offscreenOpen = false;
    });
    browserMocks.removePermissions.mockReset().mockResolvedValue(true);
    browserMocks.download.mockReset().mockResolvedValue(42);
    browserMocks.searchDownloads.mockReset().mockResolvedValue([{ id: 42, state: 'in_progress' }]);
    browserMocks.cancelDownload.mockReset().mockResolvedValue(undefined);
  });

  it('runs an offscreen job, saves the Blob URL, and releases resources on completion', async () => {
    const manager = await import('../../src/platform/chrome/zip-export-manager');
    const started = await manager.startZipExport([createCandidate()]);

    expect(started).toMatchObject({ status: 'fetching', totalItems: 1 });
    expect(browserMocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'offscreen.html', reasons: ['BLOBS'] }),
    );
    expect(browserMocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'offscreen', type: 'CREATE_ZIP' }),
    );

    const jobId = started.jobId!;
    await manager.handleZipBackgroundEvent({
      target: 'background',
      type: 'ZIP_PROGRESS',
      jobId,
      phase: 'fetching',
      completedItems: 1,
      processedBytes: 12,
      outputBytes: 20,
      currentFilename: 'photo.png',
    });
    await manager.handleZipBackgroundEvent({
      target: 'background',
      type: 'ZIP_READY',
      jobId,
      blobUrl: 'blob:chrome-extension://test-extension-id/archive',
      processedBytes: 12,
      outputBytes: 20,
    });

    expect(browserMocks.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'blob:chrome-extension://test-extension-id/archive',
        filename: expect.stringMatching(/^Discord Media Exporter\/discord-media-.*\.zip$/),
      }),
    );
    expect(await manager.getZipExportState()).toMatchObject({ status: 'saving', downloadId: 42 });

    await manager.handleZipDownloadChanged({ id: 42, state: { current: 'complete' } });

    expect(await manager.getZipExportState()).toMatchObject({ status: 'complete' });
    expect(browserMocks.removePermissions).toHaveBeenCalledOnce();
    expect(browserMocks.closeDocument).toHaveBeenCalledOnce();
  });

  it('does not save a partial ZIP after an offscreen failure', async () => {
    const manager = await import('../../src/platform/chrome/zip-export-manager');
    const started = await manager.startZipExport([createCandidate()]);
    await manager.handleZipBackgroundEvent({
      target: 'background',
      type: 'ZIP_FAILED',
      jobId: started.jobId!,
      code: 'FETCH_FAILED',
      filename: 'photo.png',
    });

    const state = await manager.getZipExportState();
    expect(state.status).toBe('failed');
    expect(state.error).toEqual({ code: 'FETCH_FAILED', params: { filename: 'photo.png' } });
    expect(state.error?.params?.filename).not.toContain('https://');
    expect(browserMocks.download).not.toHaveBeenCalled();
    expect(browserMocks.removePermissions).toHaveBeenCalledOnce();
  });

  it('cancels the active offscreen job and releases its permission', async () => {
    const manager = await import('../../src/platform/chrome/zip-export-manager');
    const started = await manager.startZipExport([createCandidate()]);
    const state = await manager.cancelZipExport();

    expect(state.status).toBe('cancelled');
    expect(browserMocks.sendMessage).toHaveBeenCalledWith({
      target: 'offscreen',
      type: 'CANCEL_ZIP',
      jobId: started.jobId,
    });
    expect(browserMocks.removePermissions).toHaveBeenCalledOnce();
  });

  it('reports an interrupted download with FILE_NO_SPACE as disk exhaustion', async () => {
    const manager = await import('../../src/platform/chrome/zip-export-manager');
    const started = await manager.startZipExport([createCandidate()]);
    await manager.handleZipBackgroundEvent({
      target: 'background',
      type: 'ZIP_READY',
      jobId: started.jobId!,
      blobUrl: 'blob:chrome-extension://test-extension-id/archive',
      processedBytes: 12,
      outputBytes: 20,
    });

    await manager.handleZipDownloadChanged({
      id: 42,
      state: { current: 'interrupted' },
      error: { current: 'FILE_NO_SPACE' },
    });

    expect(await manager.getZipExportState()).toMatchObject({
      status: 'failed',
      error: { code: 'DOWNLOAD_NO_SPACE' },
    });
    expect(browserMocks.removePermissions).toHaveBeenCalledOnce();
    expect(browserMocks.closeDocument).toHaveBeenCalledOnce();
  });

  it('restores an interrupted FILE_NO_SPACE download as disk exhaustion', async () => {
    browserMocks.offscreenOpen = true;
    browserMocks.stored = {
      zipExportState: {
        status: 'saving',
        jobId: 'job-restored',
        archiveFilename: 'discord-media.zip',
        totalItems: 2,
        completedItems: 2,
        processedBytes: 12,
        outputBytes: 20,
        downloadId: 42,
      },
    };
    browserMocks.searchDownloads.mockResolvedValue([
      { id: 42, state: 'interrupted', error: 'FILE_NO_SPACE' },
    ]);

    const manager = await import('../../src/platform/chrome/zip-export-manager');

    expect(await manager.getZipExportState()).toMatchObject({
      status: 'failed',
      error: { code: 'DOWNLOAD_NO_SPACE' },
    });
    expect(browserMocks.removePermissions).toHaveBeenCalledOnce();
    expect(browserMocks.closeDocument).toHaveBeenCalledOnce();
  });

  it('migrates a legacy localized ZIP error without displaying the old language', async () => {
    browserMocks.stored = {
      zipExportState: {
        status: 'failed',
        totalItems: 1,
        completedItems: 0,
        processedBytes: 0,
        error: 'ZIPを生成できませんでした。',
      },
    };
    const manager = await import('../../src/platform/chrome/zip-export-manager');

    expect(await manager.getZipExportState()).toMatchObject({
      status: 'failed',
      error: { code: 'CONTEXT_LOST' },
    });
  });
});

function createCandidate(): MediaCandidate {
  return {
    id: 'media-11111111',
    sourceUrl: 'https://cdn.discordapp.com/attachments/111/222/photo.png',
    kind: 'image',
    displayName: 'photo.png',
    suggestedFilename: 'photo.png',
    source: 'image',
  };
}
