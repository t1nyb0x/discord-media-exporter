import { browser } from 'wxt/browser';
import { DownloadManager, type DownloadPlatform } from '../../domain/download-manager';
import { sanitizeFilename } from '../../domain/filename';
import type { DownloadBatchState, MediaCandidate } from '../../domain/media';

type DownloadDelta = Parameters<Parameters<typeof browser.downloads.onChanged.addListener>[0]>[0];

const REGISTRY_KEY = 'candidateRegistry';
const BATCH_KEY = 'downloadBatch';
const DOWNLOAD_DIRECTORY = 'Discord Media Exporter';

class ChromeDownloadPlatform implements DownloadPlatform {
  async loadSession(): Promise<Record<string, unknown>> {
    return browser.storage.session.get([REGISTRY_KEY, BATCH_KEY]);
  }

  async saveSession(candidates: MediaCandidate[], batch: DownloadBatchState): Promise<void> {
    await browser.storage.session.set({
      [REGISTRY_KEY]: candidates,
      [BATCH_KEY]: batch,
    });
  }

  async startDownload(candidate: MediaCandidate): Promise<number> {
    return browser.downloads.download({
      url: candidate.sourceUrl,
      filename: `${DOWNLOAD_DIRECTORY}/${sanitizeFilename(candidate.suggestedFilename)}`,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  }

  async findDownload(
    downloadId: number,
  ): Promise<{ state: 'in_progress' | 'complete' | 'interrupted'; error?: string } | null> {
    const [item] = await browser.downloads.search({ id: downloadId });
    if (item === undefined) return null;

    if (item.state === 'complete') return { state: 'complete' };
    if (item.state === 'interrupted') {
      return item.error === undefined
        ? { state: 'interrupted' }
        : { state: 'interrupted', error: item.error };
    }
    return { state: 'in_progress' };
  }
}

const manager = new DownloadManager(new ChromeDownloadPlatform());

export function registerCandidates(candidates: unknown[]): Promise<number> {
  return manager.registerCandidates(candidates);
}

export function startDownloads(candidateIds: string[]): Promise<DownloadBatchState> {
  return manager.startDownloads(candidateIds);
}

export function getDownloadState(): Promise<DownloadBatchState> {
  return manager.getDownloadState();
}

export function handleDownloadChanged(delta: DownloadDelta): Promise<void> {
  const state = delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') return Promise.resolve();
  return manager.handleDownloadChanged(delta.id, state, delta.error?.current);
}
