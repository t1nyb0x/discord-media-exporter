import { browser } from 'wxt/browser';
import type { ZipExportState } from '../../domain/media';
import {
  createIdleZipState,
  createZipArchiveFilename,
  isActiveZipStatus,
  prepareZipEntries,
  type ZipExportErrorCode,
} from '../../domain/zip-export';
import { DomainError, isUserFacingError, type UserFacingError } from '../../domain/errors';
import type { MediaCandidate } from '../../domain/media';
import { sanitizeFilename } from '../../domain/filename';
import { isRecord } from '../../shared/messages';
import { ZIP_HOST_ORIGINS } from '../../shared/permissions';
import type { OffscreenZipRequest, ZipBackgroundEvent } from '../../shared/zip-messages';

type DownloadDelta = Parameters<Parameters<typeof browser.downloads.onChanged.addListener>[0]>[0];

const ZIP_STATE_KEY = 'zipExportState';
const DOWNLOAD_DIRECTORY = 'Discord Media Exporter';
const OFFSCREEN_PATH = 'offscreen.html';
const EXTENSION_ORIGIN = `chrome-extension://${browser.runtime.id}`;
const OFFSCREEN_URL = `${EXTENSION_ORIGIN}/${OFFSCREEN_PATH}`;

/** Coordinates persisted ZIP export state across background and offscreen contexts. */
class ChromeZipExportManager {
  private state = createIdleZipState();
  private initialization: Promise<void> | undefined;

  /** Starts a new ZIP job after persisting its initial state. */
  async start(candidates: MediaCandidate[]): Promise<ZipExportState> {
    await this.ensureInitialized();
    if (isActiveZipStatus(this.state.status)) throw new DomainError({ code: 'ZIP_ALREADY_ACTIVE' });

    const entries = prepareZipEntries(candidates);
    const jobId = crypto.randomUUID();
    this.state = {
      status: 'fetching',
      jobId,
      archiveFilename: createZipArchiveFilename(),
      totalItems: entries.length,
      completedItems: 0,
      processedBytes: 0,
      outputBytes: 0,
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

  /** Cancels active ZIP creation or its final browser download. */
  async cancel(): Promise<ZipExportState> {
    await this.ensureInitialized();
    if (!isActiveZipStatus(this.state.status) || this.state.jobId === undefined) {
      return this.cloneState();
    }

    const jobId = this.state.jobId;
    const downloadId = this.state.downloadId;
    this.state.status = 'cancelled';
    this.state.error = { code: 'ZIP_CANCELLED' };
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

  /** Returns a detached snapshot of the current ZIP export state. */
  async getState(): Promise<ZipExportState> {
    await this.ensureInitialized();
    return this.cloneState();
  }

  /** Reports whether a ZIP export has unfinished work. */
  async isActive(): Promise<boolean> {
    await this.ensureInitialized();
    return isActiveZipStatus(this.state.status);
  }

  /** Applies a validated progress, ready, or failure event from the offscreen context. */
  async handleEvent(event: ZipBackgroundEvent): Promise<void> {
    await this.ensureInitialized();
    if (event.jobId !== this.state.jobId || !isActiveZipStatus(this.state.status)) return;

    switch (event.type) {
      case 'ZIP_PROGRESS':
        if (this.state.status === 'saving') return;
        this.state.status = event.phase;
        this.state.completedItems = clamp(event.completedItems, 0, this.state.totalItems);
        this.state.processedBytes = Math.max(0, event.processedBytes);
        this.state.outputBytes = Math.max(0, event.outputBytes);
        if (event.currentFilename === undefined) delete this.state.currentFilename;
        else this.state.currentFilename = event.currentFilename;
        await this.persist();
        return;
      case 'ZIP_READY':
        await this.saveZip(event.blobUrl, event.processedBytes, event.outputBytes);
        return;
      case 'ZIP_FAILED':
        if (event.cancelled === true) {
          this.state.status = 'cancelled';
          this.state.error = { code: 'ZIP_CANCELLED' };
          delete this.state.currentFilename;
          await this.persist();
          await cleanupJob(event.jobId);
          return;
        }
        await this.setFailed(event.code, event.filename);
    }
  }

  /** Applies a terminal browser download event for the generated archive. */
  async handleDownloadChanged(delta: DownloadDelta): Promise<void> {
    await this.ensureInitialized();
    if (this.state.status !== 'saving' || delta.id !== this.state.downloadId) return;
    const status = delta.state?.current;
    if (status !== 'complete' && status !== 'interrupted') return;

    await this.finishDownload(status, delta.error?.current);
  }

  /** Starts the browser download for a completed extension-owned ZIP Blob URL. */
  private async saveZip(
    blobUrl: string,
    processedBytes: number,
    outputBytes: number,
  ): Promise<void> {
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
      this.state.outputBytes = Math.max(0, outputBytes);
      this.state.completedItems = this.state.totalItems;
      delete this.state.currentFilename;
      await this.persist();
      const [download] = await browser.downloads.search({ id: downloadId });
      if (download?.state === 'complete' || download?.state === 'interrupted') {
        await this.finishDownload(download.state, download.error);
      }
    } catch {
      await this.setFailed('SAVE_FAILED');
    }
  }

  /** Restores persisted state once before manager operations. */
  private ensureInitialized(): Promise<void> {
    this.initialization ??= this.restore();
    return this.initialization;
  }

  /** Restores state and reconciles interrupted offscreen or download work. */
  private async restore(): Promise<void> {
    const stored = await browser.storage.session.get(ZIP_STATE_KEY);
    if (isZipExportState(stored[ZIP_STATE_KEY])) {
      this.state = migrateZipExportState(stored[ZIP_STATE_KEY]);
    }

    if (this.state.status === 'saving' && this.state.downloadId !== undefined) {
      const [download] = await browser.downloads.search({ id: this.state.downloadId });
      if (download?.state === 'complete') this.state.status = 'complete';
      else if (download?.state === 'interrupted' || download === undefined) {
        this.state.status = 'failed';
        this.state.error = zipError(downloadFailureCode(download?.error));
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
        this.state.error = zipError('CONTEXT_LOST');
        await this.persist();
        if (this.state.jobId !== undefined) await cleanupJob(this.state.jobId);
      }
    }
  }

  /** Marks the current job failed, persists it, and releases temporary resources. */
  private async setFailed(code: ZipExportErrorCode, filename?: string): Promise<void> {
    const jobId = this.state.jobId;
    this.state.status = 'failed';
    this.state.error = zipError(code, filename);
    delete this.state.currentFilename;
    await this.persist();
    if (jobId !== undefined) await cleanupJob(jobId);
  }

  /** Finalizes archive download state and releases temporary resources. */
  private async finishDownload(status: 'complete' | 'interrupted', reason?: string): Promise<void> {
    const jobId = this.state.jobId;
    if (status === 'complete') {
      this.state.status = 'complete';
      this.state.completedItems = this.state.totalItems;
      delete this.state.error;
    } else {
      this.state.status = 'failed';
      this.state.error = zipError(downloadFailureCode(reason));
    }
    await this.persist();
    if (jobId !== undefined) await cleanupJob(jobId);
  }

  /** Persists a detached ZIP export state snapshot. */
  private async persist(): Promise<void> {
    await browser.storage.session.set({ [ZIP_STATE_KEY]: this.cloneState() });
  }

  /** Returns a detached copy of the current ZIP export state. */
  private cloneState(): ZipExportState {
    return { ...this.state };
  }
}

const manager = new ChromeZipExportManager();

/** Starts a ZIP export for previously validated media candidates. */
export function startZipExport(candidates: MediaCandidate[]): Promise<ZipExportState> {
  return manager.start(candidates);
}

/** Cancels the active ZIP export if one exists. */
export function cancelZipExport(): Promise<ZipExportState> {
  return manager.cancel();
}

/** Returns the latest persisted ZIP export state. */
export function getZipExportState(): Promise<ZipExportState> {
  return manager.getState();
}

/** Reports whether ZIP creation or saving is active. */
export function hasActiveZipExport(): Promise<boolean> {
  return manager.isActive();
}

/** Forwards a validated offscreen ZIP event to the manager. */
export function handleZipBackgroundEvent(event: ZipBackgroundEvent): Promise<void> {
  return manager.handleEvent(event);
}

/** Forwards Chrome download changes for the generated ZIP archive. */
export function handleZipDownloadChanged(delta: DownloadDelta): Promise<void> {
  return manager.handleDownloadChanged(delta);
}

/** Creates the single offscreen ZIP document when it is not already present. */
async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await browser.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['BLOBS'],
    justification: '選択されたDiscordメディアをローカルでZIPにまとめるため',
  });
}

/** Reports whether the extension ZIP offscreen document currently exists. */
async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  return contexts.length > 0;
}

/** Revokes job artifacts, closes offscreen state, and releases optional CDN access. */
async function cleanupJob(jobId: string): Promise<void> {
  if (await hasOffscreenDocument().catch(() => false)) {
    await sendOffscreen({ target: 'offscreen', type: 'REVOKE_ZIP', jobId }).catch(() => undefined);
    await browser.offscreen.closeDocument().catch(() => undefined);
  }
  await browser.permissions.remove({ origins: [...ZIP_HOST_ORIGINS] }).catch(() => undefined);
}

/** Sends a typed ZIP request to the extension offscreen context. */
function sendOffscreen(request: OffscreenZipRequest): Promise<unknown> {
  return browser.runtime.sendMessage(request);
}

/** Reports whether a Blob URL belongs to this extension origin. */
function isExtensionBlobUrl(value: string): boolean {
  return value.startsWith(`blob:${EXTENSION_ORIGIN}/`);
}

/** Validates the minimum persisted fields required to restore ZIP export state. */
type PersistedZipExportState = Omit<ZipExportState, 'error'> & {
  error?: UserFacingError | string;
};

function isZipExportState(value: unknown): value is PersistedZipExportState {
  if (!isRecord(value)) return false;
  return (
    ['idle', 'fetching', 'packing', 'saving', 'complete', 'failed', 'cancelled'].includes(
      String(value.status),
    ) &&
    typeof value.totalItems === 'number' &&
    typeof value.completedItems === 'number' &&
    typeof value.processedBytes === 'number' &&
    (value.error === undefined || typeof value.error === 'string' || isUserFacingError(value.error))
  );
}

function migrateZipExportState(value: PersistedZipExportState): ZipExportState {
  const { error, ...state } = value;
  return {
    ...state,
    ...(error === undefined
      ? {}
      : { error: typeof error === 'string' ? { code: 'CONTEXT_LOST' } : error }),
  };
}

function zipError(code: ZipExportErrorCode, filename?: string): UserFacingError {
  return filename === undefined
    ? { code }
    : { code, params: { filename: sanitizeFilename(filename) } };
}

/** Restricts a number to an inclusive range. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Maps a Chrome download interruption reason to a safe ZIP export error code. */
function downloadFailureCode(reason: string | undefined): ZipExportErrorCode {
  return reason === 'FILE_NO_SPACE' ? 'DOWNLOAD_NO_SPACE' : 'SAVE_FAILED';
}
