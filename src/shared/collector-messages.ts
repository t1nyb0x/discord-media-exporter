import type { CandidateCollection } from '../domain/media';

export type CollectorRequest =
  | { type: 'GET_MEDIA_COLLECTOR_STATUS' }
  | { type: 'START_MEDIA_COLLECTOR' }
  | { type: 'STOP_MEDIA_COLLECTOR' }
  | { type: 'REMOVE_MEDIA_COLLECTOR_LAUNCHER' }
  | { type: 'SET_MEDIA_COLLECTOR_COUNT'; count: number };

export type CollectorResponse =
  | { type: 'MEDIA_COLLECTOR_STATUS'; active: boolean }
  | {
      type: 'MEDIA_COLLECTOR_STARTED';
      active: true;
      collection: CandidateCollection;
      visibleCandidateCount: number;
    }
  | { type: 'MEDIA_COLLECTOR_START_FAILED'; active: false; error: string };

/** Validates a popup-to-collector control message. */
export function isCollectorRequest(value: unknown): value is CollectorRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  if (
    value.type === 'GET_MEDIA_COLLECTOR_STATUS' ||
    value.type === 'START_MEDIA_COLLECTOR' ||
    value.type === 'STOP_MEDIA_COLLECTOR' ||
    value.type === 'REMOVE_MEDIA_COLLECTOR_LAUNCHER'
  ) {
    return true;
  }
  return (
    value.type === 'SET_MEDIA_COLLECTOR_COUNT' &&
    'count' in value &&
    typeof value.count === 'number' &&
    Number.isInteger(value.count) &&
    value.count >= 0 &&
    value.count <= 500
  );
}
