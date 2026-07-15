import { browser } from 'wxt/browser';
import { sanitizeFilename } from '../../domain/filename';
import type { DownloadBatchState, DownloadItemState, MediaCandidate } from '../../domain/media';
import { isValidMediaCandidate } from '../../domain/validation';
import { isRecord } from '../../shared/messages';

type DownloadDelta = Parameters<Parameters<typeof browser.downloads.onChanged.addListener>[0]>[0];

const REGISTRY_KEY = 'candidateRegistry';
const BATCH_KEY = 'downloadBatch';
const DOWNLOAD_DIRECTORY = 'Discord Media Exporter';
const MAX_CONCURRENT_DOWNLOADS = 3;

let candidateRegistry = new Map<string, MediaCandidate>();
let batchState: DownloadBatchState = { items: [] };
const activeDownloadIds = new Map<number, string>();
let initialization: Promise<void> | undefined;

export async function registerCandidates(candidates: unknown[]): Promise<number> {
  await ensureInitialized();
  if (hasActiveBatch()) {
    throw new Error('進行中のダウンロードが完了してから再スキャンしてください。');
  }
  const validCandidates = candidates.filter(isValidMediaCandidate);
  if (validCandidates.length !== candidates.length) {
    throw new Error('検証できないメディア候補が含まれています。');
  }

  candidateRegistry = new Map(validCandidates.map((candidate) => [candidate.id, candidate]));
  await persistSession();
  return candidateRegistry.size;
}

export async function startDownloads(candidateIds: string[]): Promise<DownloadBatchState> {
  await ensureInitialized();
  if (hasActiveBatch()) throw new Error('ダウンロードは既に進行中です。');
  const uniqueIds = [...new Set(candidateIds)];
  if (uniqueIds.length === 0) throw new Error('保存するメディアを選択してください。');

  const items: DownloadItemState[] = uniqueIds.map((candidateId) => {
    const candidate = candidateRegistry.get(candidateId);
    if (candidate === undefined)
      throw new Error('メディア候補の有効期限が切れました。再スキャンしてください。');
    return {
      candidateId,
      filename: candidate.suggestedFilename,
      status: 'queued',
    };
  });

  batchState = { items };
  activeDownloadIds.clear();
  await persistSession();
  void pumpQueue();
  return cloneBatchState();
}

export async function getDownloadState(): Promise<DownloadBatchState> {
  await ensureInitialized();
  return cloneBatchState();
}

export async function handleDownloadChanged(delta: DownloadDelta): Promise<void> {
  await ensureInitialized();
  const candidateId = activeDownloadIds.get(delta.id);
  if (candidateId === undefined) return;

  const item = batchState.items.find((entry) => entry.candidateId === candidateId);
  if (item === undefined) return;

  if (delta.state?.current === 'complete') {
    item.status = 'complete';
    activeDownloadIds.delete(delta.id);
  } else if (delta.state?.current === 'interrupted') {
    item.status = 'failed';
    item.error = safeInterruptReason(delta.error?.current);
    activeDownloadIds.delete(delta.id);
  } else {
    return;
  }

  await persistSession();
  void pumpQueue();
}

async function pumpQueue(): Promise<void> {
  await ensureInitialized();

  while (countInProgress() < MAX_CONCURRENT_DOWNLOADS) {
    const item = batchState.items.find((entry) => entry.status === 'queued');
    if (item === undefined) break;

    const candidate = candidateRegistry.get(item.candidateId);
    if (candidate === undefined || !isValidMediaCandidate(candidate)) {
      item.status = 'failed';
      item.error = '候補を再検証できませんでした。';
      continue;
    }

    item.status = 'in_progress';
    await persistSession();

    try {
      const downloadId = await browser.downloads.download({
        url: candidate.sourceUrl,
        filename: `${DOWNLOAD_DIRECTORY}/${sanitizeFilename(candidate.suggestedFilename)}`,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      item.downloadId = downloadId;
      activeDownloadIds.set(downloadId, item.candidateId);
    } catch {
      item.status = 'failed';
      item.error = 'ダウンロードを開始できませんでした。';
    }

    await persistSession();
  }
}

function countInProgress(): number {
  return batchState.items.filter((item) => item.status === 'in_progress').length;
}

function hasActiveBatch(): boolean {
  return batchState.items.some((item) => item.status === 'queued' || item.status === 'in_progress');
}

function safeInterruptReason(reason: string | undefined): string {
  if (reason === undefined) return 'ダウンロードが中断されました。';
  return `ダウンロードが中断されました (${reason})。`;
}

function cloneBatchState(): DownloadBatchState {
  return { items: batchState.items.map((item) => ({ ...item })) };
}

function ensureInitialized(): Promise<void> {
  initialization ??= restoreSession();
  return initialization;
}

async function restoreSession(): Promise<void> {
  const stored = await browser.storage.session.get([REGISTRY_KEY, BATCH_KEY]);
  const rawRegistry = stored[REGISTRY_KEY];
  if (Array.isArray(rawRegistry)) {
    const restoredCandidates = rawRegistry.filter(isValidMediaCandidate);
    candidateRegistry = new Map(restoredCandidates.map((candidate) => [candidate.id, candidate]));
  }

  const rawBatch = stored[BATCH_KEY];
  if (isRecord(rawBatch) && Array.isArray(rawBatch.items)) {
    batchState = {
      items: rawBatch.items.filter(isDownloadItemState).map((item) => ({ ...item })),
    };
    for (const item of batchState.items) {
      if (item.status === 'in_progress' && item.downloadId !== undefined) {
        activeDownloadIds.set(item.downloadId, item.candidateId);
      }
    }
  }
}

async function persistSession(): Promise<void> {
  await browser.storage.session.set({
    [REGISTRY_KEY]: [...candidateRegistry.values()],
    [BATCH_KEY]: cloneBatchState(),
  });
}

function isDownloadItemState(value: unknown): value is DownloadItemState {
  if (!isRecord(value)) return false;
  if (typeof value.candidateId !== 'string' || typeof value.filename !== 'string') return false;
  if (!['queued', 'in_progress', 'complete', 'failed'].includes(String(value.status))) return false;
  if (value.downloadId !== undefined && typeof value.downloadId !== 'number') return false;
  return value.error === undefined || typeof value.error === 'string';
}
