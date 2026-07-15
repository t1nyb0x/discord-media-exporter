export type MediaKind = 'image' | 'video' | 'file';

export type CandidateSource = 'anchor' | 'image' | 'video';

export interface MediaCandidate {
  id: string;
  sourceUrl: string;
  kind: MediaKind;
  displayName: string;
  suggestedFilename: string;
  source: CandidateSource;
}

export type ScanErrorCode =
  | 'NOT_DISCORD_CHANNEL'
  | 'MESSAGE_VIEWPORT_NOT_FOUND'
  | 'MESSAGE_VIEWPORT_NOT_VISIBLE'
  | 'SCAN_FAILED';

export type ScanResult =
  { ok: true; candidates: MediaCandidate[] } | { ok: false; code: ScanErrorCode; message: string };

export type DownloadStatus = 'queued' | 'in_progress' | 'complete' | 'failed';

export interface DownloadItemState {
  candidateId: string;
  filename: string;
  status: DownloadStatus;
  downloadId?: number;
  error?: string;
}

export interface DownloadBatchState {
  items: DownloadItemState[];
}

export type ZipExportStatus =
  'idle' | 'fetching' | 'packing' | 'saving' | 'complete' | 'failed' | 'cancelled';

export interface ZipExportState {
  status: ZipExportStatus;
  jobId?: string;
  archiveFilename?: string;
  totalItems: number;
  completedItems: number;
  processedBytes: number;
  currentFilename?: string;
  downloadId?: number;
  error?: string;
}
