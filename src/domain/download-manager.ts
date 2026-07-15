import type {
  CandidateCollection,
  DownloadBatchState,
  DownloadItemState,
  MediaCandidate,
} from './media';
import { isValidMediaCandidate } from './validation';
import { isRecord } from '../shared/messages';
import { discordChannelScope } from './url';

const MAX_CONCURRENT_DOWNLOADS = 3;
export const MAX_COLLECTED_CANDIDATES = 500;

export interface PlatformDownloadState {
  state: 'in_progress' | 'complete' | 'interrupted';
  error?: string;
}

export interface DownloadPlatform {
  loadSession(): Promise<Record<string, unknown>>;
  saveSession(
    candidates: MediaCandidate[],
    batch: DownloadBatchState,
    collectionScope: string | null,
  ): Promise<void>;
  startDownload(candidate: MediaCandidate): Promise<number>;
  findDownload(downloadId: number): Promise<PlatformDownloadState | null>;
}

export class DownloadManager {
  private candidateRegistry = new Map<string, MediaCandidate>();
  private collectionScope: string | null = null;
  private batchState: DownloadBatchState = { items: [] };
  private readonly activeDownloadIds = new Map<number, string>();
  private initialization: Promise<void> | undefined;

  constructor(private readonly platform: DownloadPlatform) {}

  async registerCandidates(candidates: unknown[], scope: string): Promise<CandidateCollection> {
    await this.ensureInitialized();
    if (this.hasActiveBatch()) {
      throw new Error('進行中のダウンロードが完了してから再スキャンしてください。');
    }

    const validCandidates = candidates.filter(isValidMediaCandidate);
    if (validCandidates.length !== candidates.length) {
      throw new Error('検証できないメディア候補が含まれています。');
    }

    if (discordChannelScope(scope) !== scope)
      throw new Error('スキャン対象を検証できませんでした。');
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

  async getCandidateCollection(scope: string): Promise<CandidateCollection> {
    await this.ensureInitialized();
    if (discordChannelScope(scope) !== scope || this.collectionScope !== scope) {
      return { scope: null, candidates: [] };
    }
    return this.cloneCollection();
  }

  async clearCandidateCollection(scope: string): Promise<CandidateCollection> {
    await this.ensureInitialized();
    if (this.hasActiveBatch()) {
      throw new Error('進行中のダウンロードが完了してから収集結果をクリアしてください。');
    }
    if (discordChannelScope(scope) !== scope)
      throw new Error('対象チャンネルを検証できませんでした。');
    if (this.collectionScope === scope) {
      this.candidateRegistry.clear();
      this.collectionScope = null;
      await this.persistSession();
    }
    return { scope: null, candidates: [] };
  }

  async startDownloads(candidateIds: string[]): Promise<DownloadBatchState> {
    await this.ensureInitialized();
    if (this.hasActiveBatch()) throw new Error('ダウンロードは既に進行中です。');

    const uniqueIds = [...new Set(candidateIds)];
    if (uniqueIds.length === 0) throw new Error('保存するメディアを選択してください。');

    const items: DownloadItemState[] = uniqueIds.map((candidateId) => {
      const candidate = this.candidateRegistry.get(candidateId);
      if (candidate === undefined) {
        throw new Error('メディア候補の有効期限が切れました。再スキャンしてください。');
      }
      return {
        candidateId,
        filename: candidate.suggestedFilename,
        status: 'queued',
      };
    });

    this.batchState = { items };
    this.activeDownloadIds.clear();
    await this.persistSession();
    await this.pumpQueue();
    return this.cloneBatchState();
  }

  async getRegisteredCandidates(candidateIds: string[]): Promise<MediaCandidate[]> {
    await this.ensureInitialized();
    const uniqueIds = [...new Set(candidateIds)];
    if (uniqueIds.length === 0) throw new Error('保存するメディアを選択してください。');

    return uniqueIds.map((candidateId) => {
      const candidate = this.candidateRegistry.get(candidateId);
      if (candidate === undefined || !isValidMediaCandidate(candidate)) {
        throw new Error('メディア候補の有効期限が切れました。再スキャンしてください。');
      }
      return { ...candidate };
    });
  }

  async hasActiveDownloads(): Promise<boolean> {
    await this.ensureInitialized();
    return this.hasActiveBatch();
  }

  async getDownloadState(): Promise<DownloadBatchState> {
    await this.ensureInitialized();
    await this.pumpQueue();
    return this.cloneBatchState();
  }

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
      item.error = interruptReason(error);
    }
    this.activeDownloadIds.delete(downloadId);

    await this.persistSession();
    await this.pumpQueue();
  }

  private async pumpQueue(): Promise<void> {
    while (this.countInProgress() < MAX_CONCURRENT_DOWNLOADS) {
      const item = this.batchState.items.find((entry) => entry.status === 'queued');
      if (item === undefined) break;

      const candidate = this.candidateRegistry.get(item.candidateId);
      if (candidate === undefined || !isValidMediaCandidate(candidate)) {
        item.status = 'failed';
        item.error = '候補を再検証できませんでした。';
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
        item.error = 'ダウンロードを開始できませんでした。';
      }

      await this.persistSession();
    }
  }

  private countInProgress(): number {
    return this.batchState.items.filter((item) => item.status === 'in_progress').length;
  }

  private hasActiveBatch(): boolean {
    return this.batchState.items.some(
      (item) => item.status === 'queued' || item.status === 'in_progress',
    );
  }

  private cloneBatchState(): DownloadBatchState {
    return { items: this.batchState.items.map((item) => ({ ...item })) };
  }

  private ensureInitialized(): Promise<void> {
    this.initialization ??= this.restoreSession();
    return this.initialization;
  }

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
        items: rawBatch.items.filter(isDownloadItemState).map((item) => ({ ...item })),
      };
      await this.reconcileRestoredDownloads();
      await this.persistSession();
    }
  }

  private async reconcileRestoredDownloads(): Promise<void> {
    for (const item of this.batchState.items) {
      if (item.status !== 'in_progress') continue;
      if (item.downloadId === undefined) {
        item.status = 'failed';
        item.error = 'ダウンロード状態を復元できませんでした。';
        continue;
      }

      const current = await this.platform.findDownload(item.downloadId);
      if (current === null) {
        item.status = 'failed';
        item.error = 'ダウンロード履歴を確認できませんでした。';
      } else if (current.state === 'complete') {
        item.status = 'complete';
        delete item.error;
      } else if (current.state === 'interrupted') {
        item.status = 'failed';
        item.error = interruptReason(current.error);
      } else {
        this.activeDownloadIds.set(item.downloadId, item.candidateId);
      }
    }
  }

  private async persistSession(): Promise<void> {
    await this.platform.saveSession(
      [...this.candidateRegistry.values()],
      this.cloneBatchState(),
      this.collectionScope,
    );
  }

  private cloneCollection(): CandidateCollection {
    return {
      scope: this.collectionScope,
      candidates: [...this.candidateRegistry.values()].map((candidate) => ({ ...candidate })),
    };
  }
}

function interruptReason(reason: string | undefined): string {
  if (reason === undefined) return 'ダウンロードが中断されました。';
  return `ダウンロードが中断されました (${reason})。`;
}

function isDownloadItemState(value: unknown): value is DownloadItemState {
  if (!isRecord(value)) return false;
  if (typeof value.candidateId !== 'string' || typeof value.filename !== 'string') return false;
  if (!['queued', 'in_progress', 'complete', 'failed'].includes(String(value.status))) return false;
  if (value.downloadId !== undefined && typeof value.downloadId !== 'number') return false;
  return value.error === undefined || typeof value.error === 'string';
}
