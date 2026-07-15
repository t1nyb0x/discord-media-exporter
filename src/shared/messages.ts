import type { DownloadBatchState, MediaCandidate } from '../domain/media';

export type ExtensionRequest =
  | { type: 'REGISTER_SCAN_RESULT'; candidates: MediaCandidate[] }
  | { type: 'START_DOWNLOADS'; candidateIds: string[] }
  | { type: 'GET_DOWNLOAD_STATUS' };

export type ExtensionResponse =
  | { ok: true; type: 'SCAN_REGISTERED'; count: number }
  | { ok: true; type: 'DOWNLOADS_STARTED'; state: DownloadBatchState }
  | { ok: true; type: 'DOWNLOAD_STATUS'; state: DownloadBatchState }
  | { ok: false; error: string };

export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'REGISTER_SCAN_RESULT':
      return Array.isArray(value.candidates) && value.candidates.length <= 500;
    case 'START_DOWNLOADS':
      return (
        Array.isArray(value.candidateIds) &&
        value.candidateIds.length <= 500 &&
        value.candidateIds.every((id) => typeof id === 'string')
      );
    case 'GET_DOWNLOAD_STATUS':
      return true;
    default:
      return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
