import { filenameFromUrl, sanitizeFilename } from './filename';
import { stableCandidateId } from './id';
import type { MediaCandidate } from './media';
import { attachmentIdentity, normalizeDiscordAttachmentUrl } from './url';
import { isRecord } from '../shared/messages';

const MEDIA_KINDS = new Set(['image', 'video', 'file']);
const SOURCES = new Set(['anchor', 'image', 'video']);

/** Validates an untrusted value as a canonical media candidate. */
export function isValidMediaCandidate(value: unknown): value is MediaCandidate {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !/^media-[0-9a-f]{8}$/.test(value.id)) return false;
  if (typeof value.sourceUrl !== 'string') return false;
  const url = normalizeDiscordAttachmentUrl(value.sourceUrl);
  if (url === null || value.id !== stableCandidateId(attachmentIdentity(url))) return false;
  if (typeof value.kind !== 'string' || !MEDIA_KINDS.has(value.kind)) return false;
  if (typeof value.source !== 'string' || !SOURCES.has(value.source)) return false;
  if (typeof value.displayName !== 'string' || value.displayName.length > 500) return false;
  if (typeof value.suggestedFilename !== 'string') return false;
  if (sanitizeFilename(value.suggestedFilename) !== value.suggestedFilename) return false;
  return (
    value.suggestedFilename.length <= 180 &&
    value.suggestedFilename === sanitizeFilename(filenameFromUrl(url))
  );
}
