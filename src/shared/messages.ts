import type {
  CandidateCollection,
  DownloadBatchState,
  MediaCandidate,
  ZipExportState,
} from '../domain/media';

export type ExtensionRequest =
  | { type: 'REGISTER_SCAN_RESULT'; scope: string; candidates: MediaCandidate[] }
  | { type: 'GET_SCAN_COLLECTION'; scope: string }
  | { type: 'CLEAR_SCAN_COLLECTION'; scope: string }
  | { type: 'START_DOWNLOADS'; candidateIds: string[] }
  | { type: 'GET_DOWNLOAD_STATUS' }
  | { type: 'START_ZIP_EXPORT'; candidateIds: string[] }
  | { type: 'CANCEL_ZIP_EXPORT' }
  | { type: 'GET_EXPORT_STATUS' }
  | { type: 'GET_DISCORD_LAUNCHER_SETTING' }
  | { type: 'SYNC_DISCORD_LAUNCHER_SETTING' }
  | { type: 'DISABLE_DISCORD_LAUNCHER_SETTING' };

export type ExtensionResponse =
  | { ok: true; type: 'SCAN_REGISTERED'; collection: CandidateCollection }
  | { ok: true; type: 'SCAN_COLLECTION'; collection: CandidateCollection }
  | { ok: true; type: 'SCAN_COLLECTION_CLEARED'; collection: CandidateCollection }
  | { ok: true; type: 'DOWNLOADS_STARTED'; state: DownloadBatchState }
  | { ok: true; type: 'DOWNLOAD_STATUS'; state: DownloadBatchState }
  | { ok: true; type: 'ZIP_EXPORT_STARTED'; state: ZipExportState }
  | { ok: true; type: 'ZIP_EXPORT_CANCELLED'; state: ZipExportState }
  | { ok: true; type: 'ZIP_EXPORT_STATUS'; state: ZipExportState }
  | { ok: true; type: 'DISCORD_LAUNCHER_SETTING'; enabled: boolean }
  | { ok: false; error: string };

/** Validates an untrusted extension request before background dispatch. */
export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'REGISTER_SCAN_RESULT':
      return (
        typeof value.scope === 'string' &&
        Array.isArray(value.candidates) &&
        value.candidates.length <= 500
      );
    case 'GET_SCAN_COLLECTION':
    case 'CLEAR_SCAN_COLLECTION':
      return typeof value.scope === 'string';
    case 'START_DOWNLOADS':
    case 'START_ZIP_EXPORT':
      return (
        Array.isArray(value.candidateIds) &&
        value.candidateIds.length <= 500 &&
        value.candidateIds.every((id) => typeof id === 'string')
      );
    case 'GET_DOWNLOAD_STATUS':
    case 'GET_EXPORT_STATUS':
    case 'CANCEL_ZIP_EXPORT':
    case 'GET_DISCORD_LAUNCHER_SETTING':
    case 'SYNC_DISCORD_LAUNCHER_SETTING':
    case 'DISABLE_DISCORD_LAUNCHER_SETTING':
      return true;
    default:
      return false;
  }
}

/** Narrows an unknown value to a string-keyed object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
