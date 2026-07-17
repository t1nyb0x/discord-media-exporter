import type {
  CandidateCollection,
  DownloadBatchState,
  DownloadItemState,
  MediaCandidate,
} from './media';
import { isValidMediaCandidate } from './validation';
import { isRecord } from '../shared/messages';
import { discordChannelScope } from './url';
import { DomainError, isUserFacingError, type UserFacingError } from './errors';

const MAX_CONCURRENT_DOWNLOADS = 3;
export const MAX_COLLECTED_CANDIDATES = 500;

export interface PlatformDownloadState {
  state: 'in_progress' | 'complete' | 'interrupted';
  error?: string;
}

export interface DownloadPlatform {
  /** Loads the persisted download session from the platform. */
  loadSession(): Promise<Record<string, unknown>>;
  /** Persists candidates, batch progress, and the collection scope atomically. */
  saveSession(
    candidates: MediaCandidate[],
    batch: DownloadBatchState,
    collectionScope: string | null,
  ): Promise<void>;
  /** Starts one browser-managed download and returns its platform identifier. */
  startDownload(candidate: MediaCandidate): Promise<number>;
  /** Looks up the latest platform state for a previously started download. */
  findDownload(downloadId: number): Promise<PlatformDownloadState | null>;
}

/** Coordinates validated candidate storage and bounded parallel downloads. */
export class DownloadManager {
  private candidateRegistry = new Map<string, MediaCandidate>();
  private collectionScope: string | null = null;
  private batchState: DownloadBatchState = { items: [] };
  private readonly activeDownloadIds = new Map<number, string>();
  private initialization: Promise<void> | undefined;

  constructor(private readonly platform: DownloadPlatform) {}

  /** Merges validated candidates into the current channel-scoped collection. */
  async registerCandidates(candidates: unknown[], scope: string): Promise<CandidateCollection> {
    await this.ensureInitialized();
    if (this.hasActiveBatch()) {
      throw new DomainError({ code: 'ACTIVE_DOWNLOADS' });
    }

    const validCandidates = candidates.filter(isValidMediaCandidate);
    if (validCandidates.length !== candidates.length) {
      throw new DomainError({ code: 'INVALID_CANDIDATES' });
    }

    if (discordChannelScope(scope) !== scope) throw new DomainError({ code: 'INVALID_SCAN_SCOPE' });
    if (this.collectionScope !== scope) {
      this.candidateRegistry.clear();
      this.collectionScope = scope;
    }

    for (const candidate of validCandidates) {
      if (
        this.candidateRegistry.has(candidate.id) ||
        this.candidateRegistry.size < MAX_COLLECTED_CANDIDATES
      ) {
        this.candidateRegistry.set(candidate.id, candidate);
      }
    }
    await this.persistSession();
    return this.cloneCollection();
  }

  /** Returns the candidate collection only when it belongs to the requested scope. */
  async getCandidateCollection(scope: string): Promise<CandidateCollection> {
    await this.ensureInitialized();
    if (discordChannelScope(scope) !== scope || this.collectionScope !== scope) {
      return { scope: null, candidates: [] };
    }
    return this.cloneCollection();
  }

  /** Clears an inactive candidate collection for the requested channel scope. */
  async clearCandidateCollection(scope: string): Promise<CandidateCollection> {
    await this.ensureInitialized();
    if (this.hasActiveBatch()) {
      throw new DomainError({ code: 'ACTIVE_DOWNLOADS_CLEAR' });
    }
    if (discordChannelScope(scope) !== scope)
      throw new DomainError({ code: 'INVALID_CHANNEL_SCOPE' });
    if (this.collectionScope === scope) {
      this.candidateRegistry.clear();
      this.collectionScope = null;
      await this.persistSession();
    }
    return { scope: null, candidates: [] };
  }

  /** Creates and starts a download batch for the selected candidate identifiers. */
  async startDownloads(candidateIds: string[]): Promise<DownloadBatchState> {
    await this.ensureInitialized();
    if (this.hasActiveBatch()) throw new DomainError({ code: 'DOWNLOAD_ALREADY_ACTIVE' });

    const candidates = this.resolveRegisteredCandidates(candidateIds);
    const items: DownloadItemState[] = candidates.map((candidate) => ({
      candidateId: candidate.id,
      filename: candidate.suggestedFilename,
      status: 'queued',
    }));

    this.batchState = { items };
    this.activeDownloadIds.clear();
    await this.persistSession();
    await this.pumpQueue();
    return this.cloneBatchState();
  }

  /** Resolves selected identifiers to validated candidates in collection order. */
  async getRegisteredCandidates(candidateIds: string[]): Promise<MediaCandidate[]> {
    await this.ensureInitialized();
    return this.resolveRegisteredCandidates(candidateIds).map((candidate) => ({ ...candidate }));
  }

  /** Resolves a selection against the registry without using checkbox selection order. */
  private resolveRegisteredCandidates(candidateIds: string[]): MediaCandidate[] {
    const requestedIds = new Set(candidateIds);
    if (requestedIds.size === 0) throw new DomainError({ code: 'SELECTION_REQUIRED' });

    const candidates: MediaCandidate[] = [];
    for (const candidate of this.candidateRegistry.values()) {
      if (!requestedIds.has(candidate.id)) continue;
      if (!isValidMediaCandidate(candidate)) {
        throw new DomainError({ code: 'CANDIDATE_EXPIRED' });
      }
      candidates.push(candidate);
      requestedIds.delete(candidate.id);
    }
    if (requestedIds.size > 0) {
      throw new DomainError({ code: 'CANDIDATE_EXPIRED' });
    }
    return candidates;
  }

  /** Reports whether queued or in-progress individual downloads exist. */
  async hasActiveDownloads(): Promise<boolean> {
    await this.ensureInitialized();
    return this.hasActiveBatch();
  }

  /** Advances the queue and returns a detached snapshot of batch progress. */
  async getDownloadState(): Promise<DownloadBatchState> {
    await this.ensureInitialized();
    await this.pumpQueue();
    return this.cloneBatchState();
  }

  /** Applies a terminal browser download event and starts queued work if possible. */
  async handleDownloadChanged(
    downloadId: number,
    state: PlatformDownloadState['state'],
    error?: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const candidateId = this.activeDownloadIds.get(downloadId);
    if (candidateId === undefined) return;

    const item = this.batchState.items.find((entry) => entry.candidateId === candidateId);
    if (item === undefined || state === 'in_progress') return;

    if (state === 'complete') {
      item.status = 'complete';
      delete item.error;
    } else {
      item.status = 'failed';
      item.error = interruptError(error);
    }
    this.activeDownloadIds.delete(downloadId);

    await this.persistSession();
    await this.pumpQueue();
  }

  /** Starts queued downloads until the concurrency limit is reached. */
  private async pumpQueue(): Promise<void> {
    while (this.countInProgress() < MAX_CONCURRENT_DOWNLOADS) {
      const item = this.batchState.items.find((entry) => entry.status === 'queued');
      if (item === undefined) break;

      const candidate = this.candidateRegistry.get(item.candidateId);
      if (candidate === undefined || !isValidMediaCandidate(candidate)) {
        item.status = 'failed';
        item.error = { code: 'CANDIDATE_REVALIDATION_FAILED' };
        await this.persistSession();
        continue;
      }

      item.status = 'in_progress';
      await this.persistSession();

      try {
        const downloadId = await this.platform.startDownload(candidate);
        item.downloadId = downloadId;
        this.activeDownloadIds.set(downloadId, item.candidateId);
      } catch {
        item.status = 'failed';
        item.error = { code: 'DOWNLOAD_START_FAILED' };
      }

      await this.persistSession();
    }
  }

  /** Counts items currently owned by the browser download subsystem. */
  private countInProgress(): number {
    return this.batchState.items.filter((item) => item.status === 'in_progress').length;
  }

  /** Reports whether the current batch contains unfinished items. */
  private hasActiveBatch(): boolean {
    return this.batchState.items.some(
      (item) => item.status === 'queued' || item.status === 'in_progress',
    );
  }

  /** Returns a detached copy of the current batch state. */
  private cloneBatchState(): DownloadBatchState {
    return { items: this.batchState.items.map((item) => ({ ...item })) };
  }

  /** Restores persisted state once before serving manager operations. */
  private ensureInitialized(): Promise<void> {
    this.initialization ??= this.restoreSession();
    return this.initialization;
  }

  /** Restores and validates candidates, scope, and download progress. */
  private async restoreSession(): Promise<void> {
    const stored = await this.platform.loadSession();
    const rawRegistry = stored.candidateRegistry;
    if (Array.isArray(rawRegistry)) {
      const restoredCandidates = rawRegistry.filter(isValidMediaCandidate);
      this.candidateRegistry = new Map(
        restoredCandidates.map((candidate) => [candidate.id, candidate]),
      );
    }
    const rawScope = stored.candidateCollectionScope;
    if (typeof rawScope === 'string' && discordChannelScope(rawScope) === rawScope) {
      this.collectionScope = rawScope;
    } else {
      this.candidateRegistry.clear();
    }

    const rawBatch = stored.downloadBatch;
    if (isRecord(rawBatch) && Array.isArray(rawBatch.items)) {
      this.batchState = {
        items: rawBatch.items.filter(isDownloadItemState).map(migrateDownloadItemState),
      };
      await this.reconcileRestoredDownloads();
      await this.persistSession();
    }
  }

  /** Reconciles restored in-progress items with browser download history. */
  private async reconcileRestoredDownloads(): Promise<void> {
    for (const item of this.batchState.items) {
      if (item.status !== 'in_progress') continue;
      if (item.downloadId === undefined) {
        item.status = 'failed';
        item.error = { code: 'DOWNLOAD_STATE_RESTORE_FAILED' };
        continue;
      }

      const current = await this.platform.findDownload(item.downloadId);
      if (current === null) {
        item.status = 'failed';
        item.error = { code: 'DOWNLOAD_HISTORY_MISSING' };
      } else if (current.state === 'complete') {
        item.status = 'complete';
        delete item.error;
      } else if (current.state === 'interrupted') {
        item.status = 'failed';
        item.error = interruptError(current.error);
      } else {
        this.activeDownloadIds.set(item.downloadId, item.candidateId);
      }
    }
  }

  /** Persists a detached snapshot of the current session. */
  private async persistSession(): Promise<void> {
    await this.platform.saveSession(
      [...this.candidateRegistry.values()],
      this.cloneBatchState(),
      this.collectionScope,
    );
  }

  /** Returns a detached copy of the current candidate collection. */
  private cloneCollection(): CandidateCollection {
    return {
      scope: this.collectionScope,
      candidates: [...this.candidateRegistry.values()].map((candidate) => ({ ...candidate })),
    };
  }
}

/** Converts a platform interruption reason into a user-facing message. */
function interruptError(reason: string | undefined): UserFacingError {
  return reason === undefined
    ? { code: 'DOWNLOAD_INTERRUPTED' }
    : { code: 'DOWNLOAD_INTERRUPTED', params: { reason } };
}

/** Validates a persisted download item before restoring it. */
type PersistedDownloadItemState = Omit<DownloadItemState, 'error'> & {
  error?: DownloadItemState['error'] | string;
};

function isDownloadItemState(value: unknown): value is PersistedDownloadItemState {
  if (!isRecord(value)) return false;
  if (typeof value.candidateId !== 'string' || typeof value.filename !== 'string') return false;
  if (!['queued', 'in_progress', 'complete', 'failed'].includes(String(value.status))) return false;
  if (value.downloadId !== undefined && typeof value.downloadId !== 'number') return false;
  return (
    value.error === undefined || typeof value.error === 'string' || isUserFacingError(value.error)
  );
}

/** Converts pre-i18n string errors without retaining locale-specific persisted prose. */
function migrateDownloadItemState(value: PersistedDownloadItemState): DownloadItemState {
  const { error, ...item } = value;
  return {
    ...item,
    ...(error === undefined
      ? {}
      : { error: typeof error === 'string' ? { code: 'DOWNLOAD_INTERRUPTED' } : error }),
  };
}
