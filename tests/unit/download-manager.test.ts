import { describe, expect, it } from 'vitest';
import {
  DownloadManager,
  type DownloadPlatform,
  type PlatformDownloadState,
} from '../../src/domain/download-manager';
import { stableCandidateId } from '../../src/domain/id';
import type { DownloadBatchState, MediaCandidate } from '../../src/domain/media';

describe('DownloadManager', () => {
  it('limits concurrent downloads and starts the next queued item after completion', async () => {
    const platform = new FakeDownloadPlatform();
    const manager = new DownloadManager(platform);
    const candidates = [1, 2, 3, 4].map(createCandidate);
    await manager.registerCandidates(candidates);

    const initial = await manager.startDownloads(candidates.map((candidate) => candidate.id));

    expect(platform.startedFilenames).toEqual(['file-1.png', 'file-2.png', 'file-3.png']);
    expect(initial.items.map((item) => item.status)).toEqual([
      'in_progress',
      'in_progress',
      'in_progress',
      'queued',
    ]);

    await manager.handleDownloadChanged(initial.items[0]!.downloadId!, 'complete');
    const afterCompletion = await manager.getDownloadState();

    expect(platform.startedFilenames).toEqual([
      'file-1.png',
      'file-2.png',
      'file-3.png',
      'file-4.png',
    ]);
    expect(afterCompletion.items.map((item) => item.status)).toEqual([
      'complete',
      'in_progress',
      'in_progress',
      'in_progress',
    ]);
  });

  it('isolates a start failure and continues the rest of the batch', async () => {
    const platform = new FakeDownloadPlatform();
    platform.failFilenames.add('file-2.png');
    const manager = new DownloadManager(platform);
    const candidates = [1, 2, 3, 4].map(createCandidate);
    await manager.registerCandidates(candidates);

    const state = await manager.startDownloads(candidates.map((candidate) => candidate.id));

    expect(platform.startedFilenames).toEqual([
      'file-1.png',
      'file-2.png',
      'file-3.png',
      'file-4.png',
    ]);
    expect(state.items[1]).toMatchObject({
      filename: 'file-2.png',
      status: 'failed',
      error: 'ダウンロードを開始できませんでした。',
    });
    expect(state.items.filter((item) => item.status === 'in_progress')).toHaveLength(3);
  });

  it('records an interrupted item without exposing a URL and continues queued work', async () => {
    const platform = new FakeDownloadPlatform();
    const manager = new DownloadManager(platform);
    const candidates = [1, 2, 3, 4].map(createCandidate);
    await manager.registerCandidates(candidates);
    const initial = await manager.startDownloads(candidates.map((candidate) => candidate.id));

    await manager.handleDownloadChanged(
      initial.items[0]!.downloadId!,
      'interrupted',
      'SERVER_FORBIDDEN',
    );
    const state = await manager.getDownloadState();

    expect(state.items[0]).toMatchObject({
      status: 'failed',
      error: 'ダウンロードが中断されました (SERVER_FORBIDDEN)。',
    });
    expect(state.items[0]!.error).not.toContain('https://');
    expect(state.items[3]!.status).toBe('in_progress');
  });

  it('reconciles a completed browser download after a service worker restart', async () => {
    const candidate = createCandidate(1);
    const platform = new FakeDownloadPlatform({
      candidateRegistry: [candidate],
      downloadBatch: {
        items: [
          {
            candidateId: candidate.id,
            filename: candidate.suggestedFilename,
            status: 'in_progress',
            downloadId: 42,
          },
        ],
      },
    });
    platform.downloadStates.set(42, { state: 'complete' });

    const manager = new DownloadManager(platform);
    const state = await manager.getDownloadState();

    expect(state.items).toEqual([
      {
        candidateId: candidate.id,
        filename: candidate.suggestedFilename,
        status: 'complete',
        downloadId: 42,
      },
    ]);
  });
});

class FakeDownloadPlatform implements DownloadPlatform {
  readonly startedFilenames: string[] = [];
  readonly failFilenames = new Set<string>();
  readonly downloadStates = new Map<number, PlatformDownloadState>();
  private nextDownloadId = 1;

  constructor(private stored: Record<string, unknown> = {}) {}

  async loadSession(): Promise<Record<string, unknown>> {
    return clone(this.stored);
  }

  async saveSession(candidates: MediaCandidate[], batch: DownloadBatchState): Promise<void> {
    this.stored = clone({ candidateRegistry: candidates, downloadBatch: batch });
  }

  async startDownload(candidate: MediaCandidate): Promise<number> {
    this.startedFilenames.push(candidate.suggestedFilename);
    if (this.failFilenames.has(candidate.suggestedFilename)) throw new Error('simulated failure');

    const downloadId = this.nextDownloadId;
    this.nextDownloadId += 1;
    this.downloadStates.set(downloadId, { state: 'in_progress' });
    return downloadId;
  }

  async findDownload(downloadId: number): Promise<PlatformDownloadState | null> {
    return this.downloadStates.get(downloadId) ?? null;
  }
}

function createCandidate(index: number): MediaCandidate {
  const pathname = `/attachments/111/${200 + index}/file-${index}.png`;
  return {
    id: stableCandidateId(pathname),
    sourceUrl: `https://cdn.discordapp.com${pathname}?ex=test`,
    kind: 'image',
    displayName: `file-${index}.png`,
    suggestedFilename: `file-${index}.png`,
    source: 'image',
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
