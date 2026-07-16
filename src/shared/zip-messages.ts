import type { ZipEntryCandidate, ZipExportErrorCode } from '../domain/zip-export';
import { isRecord } from './messages';

const ZIP_ERROR_CODES = new Set([
  'FETCH_FAILED',
  'INVALID_REDIRECT',
  'STORAGE_QUOTA_EXCEEDED',
  'TEMP_WRITE_FAILED',
  'ZIP_FAILED',
  'SAVE_FAILED',
  'DOWNLOAD_NO_SPACE',
  'CONTEXT_LOST',
]);

export type OffscreenZipRequest =
  | {
      target: 'offscreen';
      type: 'CREATE_ZIP';
      jobId: string;
      entries: ZipEntryCandidate[];
    }
  | { target: 'offscreen'; type: 'CANCEL_ZIP'; jobId: string }
  | { target: 'offscreen'; type: 'REVOKE_ZIP'; jobId: string };

export type ZipBackgroundEvent =
  | {
      target: 'background';
      type: 'ZIP_PROGRESS';
      jobId: string;
      phase: 'fetching' | 'packing';
      completedItems: number;
      processedBytes: number;
      outputBytes: number;
      currentFilename?: string;
    }
  | {
      target: 'background';
      type: 'ZIP_READY';
      jobId: string;
      blobUrl: string;
      processedBytes: number;
      outputBytes: number;
    }
  | {
      target: 'background';
      type: 'ZIP_FAILED';
      jobId: string;
      code: ZipExportErrorCode;
      filename?: string;
      cancelled?: boolean;
    };

/** Validates a background-to-offscreen ZIP request. */
export function isOffscreenZipRequest(value: unknown): value is OffscreenZipRequest {
  if (!isRecord(value) || value.target !== 'offscreen' || typeof value.type !== 'string') {
    return false;
  }
  if (typeof value.jobId !== 'string') return false;
  if (value.type === 'CANCEL_ZIP' || value.type === 'REVOKE_ZIP') return true;
  if (value.type !== 'CREATE_ZIP' || !Array.isArray(value.entries)) return false;
  return value.entries.every(isZipEntryCandidate);
}

/** Validates an offscreen-to-background ZIP event. */
export function isZipBackgroundEvent(value: unknown): value is ZipBackgroundEvent {
  if (!isRecord(value) || value.target !== 'background' || typeof value.type !== 'string') {
    return false;
  }
  if (typeof value.jobId !== 'string') return false;
  if (value.type === 'ZIP_PROGRESS') {
    return (
      (value.phase === 'fetching' || value.phase === 'packing') &&
      typeof value.completedItems === 'number' &&
      typeof value.processedBytes === 'number' &&
      typeof value.outputBytes === 'number' &&
      (value.currentFilename === undefined || typeof value.currentFilename === 'string')
    );
  }
  if (value.type === 'ZIP_READY') {
    return (
      typeof value.blobUrl === 'string' &&
      typeof value.processedBytes === 'number' &&
      typeof value.outputBytes === 'number'
    );
  }
  if (value.type === 'ZIP_FAILED') {
    return (
      typeof value.code === 'string' &&
      ZIP_ERROR_CODES.has(value.code) &&
      (value.filename === undefined || typeof value.filename === 'string') &&
      (value.cancelled === undefined || typeof value.cancelled === 'boolean')
    );
  }
  return false;
}

/** Validates one serialized ZIP entry candidate. */
function isZipEntryCandidate(value: unknown): value is ZipEntryCandidate {
  return (
    isRecord(value) &&
    typeof value.candidateId === 'string' &&
    typeof value.sourceUrl === 'string' &&
    typeof value.filename === 'string'
  );
}
