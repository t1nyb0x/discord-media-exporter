/** Stable error codes passed between extension contexts and translated at the UI boundary. */
export type UserFacingErrorCode =
  | 'INVALID_REQUEST'
  | 'UNEXPECTED_RESPONSE'
  | 'RESPONSE_INVALID'
  | 'ACTIVE_DOWNLOADS'
  | 'INVALID_CANDIDATES'
  | 'INVALID_SCAN_SCOPE'
  | 'ACTIVE_DOWNLOADS_CLEAR'
  | 'INVALID_CHANNEL_SCOPE'
  | 'DOWNLOAD_ALREADY_ACTIVE'
  | 'SELECTION_REQUIRED'
  | 'CANDIDATE_EXPIRED'
  | 'CANDIDATE_REVALIDATION_FAILED'
  | 'DOWNLOAD_START_FAILED'
  | 'DOWNLOAD_INTERRUPTED'
  | 'DOWNLOAD_STATE_RESTORE_FAILED'
  | 'DOWNLOAD_HISTORY_MISSING'
  | 'ZIP_SELECTION_REQUIRED'
  | 'ZIP_FILENAME_CONFLICT'
  | 'ZIP_ALREADY_ACTIVE'
  | 'ZIP_ACTIVE_CLEAR'
  | 'ZIP_ACTIVE_DOWNLOAD'
  | 'DOWNLOADS_ACTIVE_ZIP'
  | 'ZIP_CANCELLED'
  | 'CDN_PERMISSION_DENIED'
  | 'FETCH_FAILED'
  | 'INVALID_REDIRECT'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'TEMP_WRITE_FAILED'
  | 'ZIP_FAILED'
  | 'SAVE_FAILED'
  | 'DOWNLOAD_NO_SPACE'
  | 'CONTEXT_LOST'
  | 'COLLECTOR_START_INTERRUPTED'
  | 'COLLECTION_REGISTER_FAILED'
  | 'COLLECTOR_START_FAILED'
  | 'NOT_DISCORD_CHANNEL'
  | 'MESSAGE_VIEWPORT_NOT_FOUND'
  | 'MESSAGE_VIEWPORT_NOT_VISIBLE'
  | 'SCAN_FAILED';

export type ErrorParamName = 'filename' | 'reason';
export type UserFacingErrorParams = Partial<Record<ErrorParamName, string | number>>;

export interface UserFacingError {
  code: UserFacingErrorCode;
  params?: UserFacingErrorParams;
}

const ERROR_CODES = new Set<UserFacingErrorCode>([
  'INVALID_REQUEST',
  'UNEXPECTED_RESPONSE',
  'RESPONSE_INVALID',
  'ACTIVE_DOWNLOADS',
  'INVALID_CANDIDATES',
  'INVALID_SCAN_SCOPE',
  'ACTIVE_DOWNLOADS_CLEAR',
  'INVALID_CHANNEL_SCOPE',
  'DOWNLOAD_ALREADY_ACTIVE',
  'SELECTION_REQUIRED',
  'CANDIDATE_EXPIRED',
  'CANDIDATE_REVALIDATION_FAILED',
  'DOWNLOAD_START_FAILED',
  'DOWNLOAD_INTERRUPTED',
  'DOWNLOAD_STATE_RESTORE_FAILED',
  'DOWNLOAD_HISTORY_MISSING',
  'ZIP_SELECTION_REQUIRED',
  'ZIP_FILENAME_CONFLICT',
  'ZIP_ALREADY_ACTIVE',
  'ZIP_ACTIVE_CLEAR',
  'ZIP_ACTIVE_DOWNLOAD',
  'DOWNLOADS_ACTIVE_ZIP',
  'ZIP_CANCELLED',
  'CDN_PERMISSION_DENIED',
  'FETCH_FAILED',
  'INVALID_REDIRECT',
  'STORAGE_QUOTA_EXCEEDED',
  'TEMP_WRITE_FAILED',
  'ZIP_FAILED',
  'SAVE_FAILED',
  'DOWNLOAD_NO_SPACE',
  'CONTEXT_LOST',
  'COLLECTOR_START_INTERRUPTED',
  'COLLECTION_REGISTER_FAILED',
  'COLLECTOR_START_FAILED',
  'NOT_DISCORD_CHANNEL',
  'MESSAGE_VIEWPORT_NOT_FOUND',
  'MESSAGE_VIEWPORT_NOT_VISIBLE',
  'SCAN_FAILED',
]);

const PARAM_NAMES = new Set<ErrorParamName>(['filename', 'reason']);

/** An internal domain exception that contains no localized prose. */
export class DomainError extends Error {
  constructor(readonly detail: UserFacingError) {
    super(detail.code);
    this.name = 'DomainError';
  }
}

/** Validates errors received from storage or another extension context. */
export function isUserFacingError(value: unknown): value is UserFacingError {
  if (typeof value !== 'object' || value === null || !('code' in value)) return false;
  if (typeof value.code !== 'string' || !ERROR_CODES.has(value.code as UserFacingErrorCode)) {
    return false;
  }
  if (!('params' in value) || value.params === undefined) return true;
  if (typeof value.params !== 'object' || value.params === null || Array.isArray(value.params)) {
    return false;
  }
  return Object.entries(value.params).every(
    ([key, param]) =>
      PARAM_NAMES.has(key as ErrorParamName) &&
      (typeof param === 'string' || (typeof param === 'number' && Number.isFinite(param))) &&
      (typeof param !== 'string' || param.length <= 240),
  );
}

/** Converts unknown exceptions to a stable boundary-safe error. */
export function userFacingError(error: unknown): UserFacingError {
  return error instanceof DomainError ? error.detail : { code: 'UNEXPECTED_RESPONSE' };
}
