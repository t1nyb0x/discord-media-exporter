export type CollectorRequest =
  | { type: 'GET_MEDIA_COLLECTOR_STATUS' }
  | { type: 'STOP_MEDIA_COLLECTOR' }
  | { type: 'SET_MEDIA_COLLECTOR_COUNT'; count: number };

export interface CollectorResponse {
  active: boolean;
}

export function isCollectorRequest(value: unknown): value is CollectorRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  if (value.type === 'GET_MEDIA_COLLECTOR_STATUS' || value.type === 'STOP_MEDIA_COLLECTOR') {
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
