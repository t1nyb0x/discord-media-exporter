import { filenameFromUrl, sanitizeFilename } from '../../domain/filename';
import { stableCandidateId } from '../../domain/id';
import type { CandidateSource, MediaCandidate, MediaKind, ScanResult } from '../../domain/media';
import {
  attachmentIdentity,
  discordChannelScope,
  inferMediaKind,
  normalizeDiscordAttachmentUrl,
} from '../../domain/url';
import { findMessageViewport } from './message-viewport';
import { intersectRects, isElementVisibleInRect, type RectLike } from './visibility';

const MAX_CANDIDATES = 500;

/** Collects allowlisted media that is visible inside the Discord message viewport. */
export function extractVisibleDiscordMedia(
  documentObject: Document,
  windowObject: Window,
): ScanResult {
  const scope = discordChannelScope(windowObject.location.href);
  if (scope === null) {
    return {
      ok: false,
      code: 'NOT_DISCORD_CHANNEL',
    };
  }

  const messageViewport = findMessageViewport(documentObject);
  if (messageViewport === null) {
    return {
      ok: false,
      code: 'MESSAGE_VIEWPORT_NOT_FOUND',
    };
  }

  const visibleViewport = createVisibleViewport(messageViewport, windowObject);
  if (visibleViewport === null) {
    return {
      ok: false,
      code: 'MESSAGE_VIEWPORT_NOT_VISIBLE',
    };
  }

  try {
    const candidates = collectCandidates(messageViewport, visibleViewport, windowObject);
    return { ok: true, scope, candidates };
  } catch {
    return {
      ok: false,
      code: 'SCAN_FAILED',
    };
  }
}

/** Intersects the Discord message viewport with the browser viewport. */
function createVisibleViewport(messageViewport: Element, windowObject: Window): RectLike | null {
  const browserViewport: RectLike = {
    top: 0,
    right: windowObject.innerWidth,
    bottom: windowObject.innerHeight,
    left: 0,
    width: windowObject.innerWidth,
    height: windowObject.innerHeight,
  };
  return intersectRects(messageViewport.getBoundingClientRect(), browserViewport);
}

/** Collects and deduplicates visible candidates in their message DOM order. */
function collectCandidates(
  messageViewport: Element,
  visibleViewport: RectLike,
  windowObject: Window,
): MediaCandidate[] {
  const candidatesByIdentity = new Map<string, MediaCandidate>();

  for (const element of messageViewport.querySelectorAll<
    HTMLAnchorElement | HTMLImageElement | HTMLVideoElement
  >('a[href], img, video')) {
    if (element instanceof HTMLAnchorElement) {
      collectAnchorCandidate(candidatesByIdentity, element, visibleViewport, windowObject);
    } else {
      collectStandaloneMediaCandidate(candidatesByIdentity, element, visibleViewport, windowObject);
    }
    if (candidatesByIdentity.size >= MAX_CANDIDATES) break;
  }

  return [...candidatesByIdentity.values()];
}

/** Collects one visible attachment anchor at its first DOM position. */
function collectAnchorCandidate(
  candidates: Map<string, MediaCandidate>,
  anchor: HTMLAnchorElement,
  visibleViewport: RectLike,
  windowObject: Window,
): void {
  const url = normalizeDiscordAttachmentUrl(anchor.href, windowObject.location.href);
  if (url === null) return;

  const mediaElement = anchor.querySelector('video, img');
  const visibilityElement = mediaElement ?? anchor;
  if (!isElementVisibleInRect(visibilityElement, visibleViewport, windowObject)) return;

  const source: CandidateSource =
    mediaElement?.tagName === 'VIDEO'
      ? 'video'
      : mediaElement?.tagName === 'IMG'
        ? 'image'
        : 'anchor';
  const kind: MediaKind =
    source === 'video' ? 'video' : source === 'image' ? 'image' : inferMediaKind(url);
  addCandidate(candidates, url, kind, source);
}

/** Collects media that is not already represented by a valid attachment anchor. */
function collectStandaloneMediaCandidate(
  candidates: Map<string, MediaCandidate>,
  element: HTMLImageElement | HTMLVideoElement,
  visibleViewport: RectLike,
  windowObject: Window,
): void {
  const containingAnchor = element.closest<HTMLAnchorElement>('a[href]');
  if (
    containingAnchor !== null &&
    normalizeDiscordAttachmentUrl(containingAnchor.href, windowObject.location.href) !== null
  ) {
    return;
  }
  if (!isElementVisibleInRect(element, visibleViewport, windowObject)) return;

  const rawUrl = element.currentSrc || element.src;
  const url = normalizeDiscordAttachmentUrl(rawUrl, windowObject.location.href);
  if (url === null) return;

  const source: CandidateSource = element instanceof HTMLVideoElement ? 'video' : 'image';
  addCandidate(candidates, url, source, source);
}

/** Adds a normalized candidate unless its attachment identity already exists. */
function addCandidate(
  candidates: Map<string, MediaCandidate>,
  url: URL,
  kind: MediaKind,
  source: CandidateSource,
): void {
  const identity = attachmentIdentity(url);
  if (candidates.has(identity)) return;

  const suggestedFilename = sanitizeFilename(filenameFromUrl(url));
  candidates.set(identity, {
    id: stableCandidateId(identity),
    sourceUrl: url.toString(),
    kind,
    displayName: suggestedFilename,
    suggestedFilename,
    source,
  });
}
