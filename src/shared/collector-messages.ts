export type CollectorRequest =
  { type: 'GET_MEDIA_COLLECTOR_STATUS' } | { type: 'STOP_MEDIA_COLLECTOR' };

export interface CollectorResponse {
  active: boolean;
}

export function isCollectorRequest(value: unknown): value is CollectorRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  return value.type === 'GET_MEDIA_COLLECTOR_STATUS' || value.type === 'STOP_MEDIA_COLLECTOR';
}
