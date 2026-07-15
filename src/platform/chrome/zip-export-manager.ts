import { browser } from 'wxt/browser';
import type { ZipExportState } from '../../domain/media';
import {
  createIdleZipState,
  createZipArchiveFilename,
  isActiveZipStatus,
  prepareZipEntries,
  zipExportErrorMessage,
  type ZipExportErrorCode,
} from '../../domain/zip-export';
import type { MediaCandidate } from '../../domain/media';
import { isRecord } from '../../shared/messages';
import { ZIP_HOST_ORIGINS } from '../../shared/permissions';
import type { OffscreenZipRequest, ZipBackgroundEvent } from '../../shared/zip-messages';

type DownloadDelta = Parameters<Parameters<typeof browser.downloads.onChanged.addListener>[0]>[0];

const ZIP_STATE_KEY = 'zipExportState';
const DOWNLOAD_DIRECTORY = 'Discord Media Exporter';
const OFFSCREEN_PATH = 'offscreen.html';
const EXTENSION_ORIGIN = `chrome-extension://${browser.runtime.id}`;
const OFFSCREEN_URL = `${EXTENSION_ORIGIN}/${OFFSCREEN_PATH}`;

class ChromeZipExportManager {
  private state = createIdleZipState();
  private initialization: Promise<void> | undefined;

  async start(candidates: MediaCandidate[]): Promise<ZipExportState> {
    await this.ensureInitialized();
    if (isActiveZipStatus(this.state.status)) throw new Error('ZIP出力は既に進行中です。');

    const entries = prepareZipEntries(candidates);
    const jobId = crypto.randomUUID();
    this.state = {
      status: 'fetching',
      jobId,
      archiveFilename: createZipArchiveFilename(),
      totalItems: entries.length,
      completedItems: 0,
      processedBytes: 0,
    };
    await this.persist();

    try {
      await ensureOffscreenDocument();
      const response: unknown = await browser.runtime.sendMessage({
        target: 'offscreen',
        type: 'CREATE_ZIP',
        jobId,
        entries,
      } satisfies OffscreenZipRequest);
      if (!isRecord(response) || response.accepted !== true) throw new Error('not accepted');
    } catch {
      await this.setFailed('CONTEXT_LOST');
    }

    return this.cloneState();
  }

  async cancel(): Promise<ZipExportState> {
    await this.ensureInitialized();
    if (!isActiveZipStatus(this.state.status) || this.state.jobId === undefined) {
      return this.cloneState();
    }

    const jobId = this.state.jobId;
    const downloadId = this.state.downloadId;
    this.state.status = 'cancelled';
    this.state.error = 'ZIP出力をキャンセルしました。';
    delete this.state.currentFilename;
    await this.persist();

    if (downloadId !== undefined) {
      await browser.downloads.cancel(downloadId).catch(() => undefined);
    } else {
      await sendOffscreen({ target: 'offscreen', type: 'CANCEL_ZIP', jobId }).catch(
        () => undefined,
      );
    }
    await cleanupJob(jobId);
    return this.cloneState();
  }

  async getState(): Promise<ZipExportState> {
    await this.ensureInitialized();
    return this.cloneState();
  }

  async isActive(): Promise<boolean> {
    await this.ensureInitialized();
    return isActiveZipStatus(this.state.status);
  }

  async handleEvent(event: ZipBackgroundEvent): Promise<void> {
    await this.ensureInitialized();
    if (event.jobId !== this.state.jobId || !isActiveZipStatus(this.state.status)) return;

    switch (event.type) {
      case 'ZIP_PROGRESS':
        if (this.state.status === 'saving') return;
        this.state.status = event.phase;
        this.state.completedItems = clamp(event.completedItems, 0, this.state.totalItems);
        this.state.processedBytes = Math.max(0, event.processedBytes);
        if (event.currentFilename === undefined) delete this.state.currentFilename;
        else this.state.currentFilename = event.currentFilename;
        await this.persist();
        return;
      case 'ZIP_READY':
        await this.saveZip(event.blobUrl, event.processedBytes);
        return;
      case 'ZIP_FAILED':
        if (event.cancelled === true) {
          this.state.status = 'cancelled';
          this.state.error = 'ZIP出力をキャンセルしました。';
          delete this.state.currentFilename;
          await this.persist();
          await cleanupJob(event.jobId);
          return;
        }
        await this.setFailed(event.code, event.filename);
    }
  }

  async handleDownloadChanged(delta: DownloadDelta): Promise<void> {
    await this.ensureInitialized();
    if (this.state.status !== 'saving' || delta.id !== this.state.downloadId) return;
    const status = delta.state?.current;
    if (status !== 'complete' && status !== 'interrupted') return;

    await this.finishDownload(status);
  }

  private async saveZip(blobUrl: string, processedBytes: number): Promise<void> {
    if (!isExtensionBlobUrl(blobUrl) || this.state.archiveFilename === undefined) {
      await this.setFailed('ZIP_FAILED');
      return;
    }

    try {
      const downloadId = await browser.downloads.download({
        url: blobUrl,
        filename: `${DOWNLOAD_DIRECTORY}/${this.state.archiveFilename}`,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      this.state.status = 'saving';
      this.state.downloadId = downloadId;
      this.state.processedBytes = Math.max(0, processedBytes);
      this.state.completedItems = this.state.totalItems;
      delete this.state.currentFilename;
      await this.persist();
      const [download] = await browser.downloads.search({ id: downloadId });
      if (download?.state === 'complete' || download?.state === 'interrupted') {
        await this.finishDownload(download.state);
      }
    } catch {
      await this.setFailed('SAVE_FAILED');
    }
  }

  private ensureInitialized(): Promise<void> {
    this.initialization ??= this.restore();
    return this.initialization;
  }

  private async restore(): Promise<void> {
    const stored = await browser.storage.session.get(ZIP_STATE_KEY);
    if (isZipExportState(stored[ZIP_STATE_KEY])) {
      this.state = { ...stored[ZIP_STATE_KEY] };
    }

    if (this.state.status === 'saving' && this.state.downloadId !== undefined) {
      const [download] = await browser.downloads.search({ id: this.state.downloadId });
      if (download?.state === 'complete') this.state.status = 'complete';
      else if (download?.state === 'interrupted' || download === undefined) {
        this.state.status = 'failed';
        this.state.error = zipExportErrorMessage('SAVE_FAILED');
      }
      await this.persist();
      if (!isActiveZipStatus(this.state.status) && this.state.jobId !== undefined) {
        await cleanupJob(this.state.jobId);
      }
      return;
    }

    if (this.state.status === 'fetching' || this.state.status === 'packing') {
      if (!(await hasOffscreenDocument())) {
        this.state.status = 'failed';
        this.state.error = zipExportErrorMessage('CONTEXT_LOST');
        await this.persist();
        if (this.state.jobId !== undefined) await cleanupJob(this.state.jobId);
      }
    }
  }

  private async setFailed(code: ZipExportErrorCode, filename?: string): Promise<void> {
    const jobId = this.state.jobId;
    this.state.status = 'failed';
    this.state.error = zipExportErrorMessage(code, filename);
    delete this.state.currentFilename;
    await this.persist();
    if (jobId !== undefined) await cleanupJob(jobId);
  }

  private async finishDownload(status: 'complete' | 'interrupted'): Promise<void> {
    const jobId = this.state.jobId;
    if (status === 'complete') {
      this.state.status = 'complete';
      this.state.completedItems = this.state.totalItems;
      delete this.state.error;
    } else {
      this.state.status = 'failed';
      this.state.error = zipExportErrorMessage('SAVE_FAILED');
    }
    await this.persist();
    if (jobId !== undefined) await cleanupJob(jobId);
  }

  private async persist(): Promise<void> {
    await browser.storage.session.set({ [ZIP_STATE_KEY]: this.cloneState() });
  }

  private cloneState(): ZipExportState {
    return { ...this.state };
  }
}

const manager = new ChromeZipExportManager();

export function startZipExport(candidates: MediaCandidate[]): Promise<ZipExportState> {
  return manager.start(candidates);
}

export function cancelZipExport(): Promise<ZipExportState> {
  return manager.cancel();
}

export function getZipExportState(): Promise<ZipExportState> {
  return manager.getState();
}

export function hasActiveZipExport(): Promise<boolean> {
  return manager.isActive();
}

export function handleZipBackgroundEvent(event: ZipBackgroundEvent): Promise<void> {
  return manager.handleEvent(event);
}

export function handleZipDownloadChanged(delta: DownloadDelta): Promise<void> {
  return manager.handleDownloadChanged(delta);
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await browser.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['BLOBS'],
    justification: '選択されたDiscordメディアをローカルでZIPにまとめるため',
  });
}

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  return contexts.length > 0;
}

async function cleanupJob(jobId: string): Promise<void> {
  if (await hasOffscreenDocument().catch(() => false)) {
    await sendOffscreen({ target: 'offscreen', type: 'REVOKE_ZIP', jobId }).catch(() => undefined);
    await browser.offscreen.closeDocument().catch(() => undefined);
  }
  await browser.permissions.remove({ origins: [...ZIP_HOST_ORIGINS] }).catch(() => undefined);
}

function sendOffscreen(request: OffscreenZipRequest): Promise<unknown> {
  return browser.runtime.sendMessage(request);
}

function isExtensionBlobUrl(value: string): boolean {
  return value.startsWith(`blob:${EXTENSION_ORIGIN}/`);
}

function isZipExportState(value: unknown): value is ZipExportState {
  if (!isRecord(value)) return false;
  return (
    ['idle', 'fetching', 'packing', 'saving', 'complete', 'failed', 'cancelled'].includes(
      String(value.status),
    ) &&
    typeof value.totalItems === 'number' &&
    typeof value.completedItems === 'number' &&
    typeof value.processedBytes === 'number'
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
