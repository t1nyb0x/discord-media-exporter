import { filenameFromUrl, sanitizeFilename } from '../../domain/filename';
import { stableCandidateId } from '../../domain/id';
import type { CandidateSource, MediaCandidate, MediaKind, ScanResult } from '../../domain/media';
import {
  attachmentIdentity,
  inferMediaKind,
  isDiscordChannelUrl,
  normalizeDiscordAttachmentUrl,
} from '../../domain/url';
import { intersectRects, isElementVisibleInRect, type RectLike } from './visibility';

const MAX_CANDIDATES = 500;
const MESSAGE_VIEWPORT_SELECTORS = ['[data-list-id="chat-messages"]', 'main [role="log"]'] as const;

export function extractVisibleDiscordMedia(
  documentObject: Document,
  windowObject: Window,
): ScanResult {
  if (!isDiscordChannelUrl(windowObject.location.href)) {
    return {
      ok: false,
      code: 'NOT_DISCORD_CHANNEL',
      message: 'Discord のチャンネル画面を開いてください。',
    };
  }

  const messageViewport = findMessageViewport(documentObject);
  if (messageViewport === null) {
    return {
      ok: false,
      code: 'MESSAGE_VIEWPORT_NOT_FOUND',
      message: 'メッセージ表示領域を確認できませんでした。',
    };
  }

  const visibleViewport = createVisibleViewport(messageViewport, windowObject);
  if (visibleViewport === null) {
    return {
      ok: false,
      code: 'MESSAGE_VIEWPORT_NOT_VISIBLE',
      message: 'メッセージ表示領域が画面内にありません。',
    };
  }

  try {
    const candidates = collectCandidates(messageViewport, visibleViewport, windowObject);
    return { ok: true, candidates };
  } catch {
    return {
      ok: false,
      code: 'SCAN_FAILED',
      message: '表示中メディアの確認に失敗しました。',
    };
  }
}

function findMessageViewport(documentObject: Document): Element | null {
  for (const selector of MESSAGE_VIEWPORT_SELECTORS) {
    const element = documentObject.querySelector(selector);
    if (element !== null) return element;
  }
  return null;
}

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

function collectCandidates(
  messageViewport: Element,
  visibleViewport: RectLike,
  windowObject: Window,
): MediaCandidate[] {
  const candidatesByIdentity = new Map<string, MediaCandidate>();

  for (const anchor of messageViewport.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = normalizeDiscordAttachmentUrl(anchor.href, windowObject.location.href);
    if (url === null) continue;

    const mediaElement = anchor.querySelector('video, img');
    const visibilityElement = mediaElement ?? anchor;
    if (!isElementVisibleInRect(visibilityElement, visibleViewport, windowObject)) continue;

    const source: CandidateSource =
      mediaElement?.tagName === 'VIDEO'
        ? 'video'
        : mediaElement?.tagName === 'IMG'
          ? 'image'
          : 'anchor';
    const kind: MediaKind =
      source === 'video' ? 'video' : source === 'image' ? 'image' : inferMediaKind(url);
    addCandidate(candidatesByIdentity, url, kind, source);
    if (candidatesByIdentity.size >= MAX_CANDIDATES) break;
  }

  if (candidatesByIdentity.size < MAX_CANDIDATES) {
    for (const element of messageViewport.querySelectorAll<HTMLImageElement | HTMLVideoElement>(
      'img, video',
    )) {
      const containingAnchor = element.closest<HTMLAnchorElement>('a[href]');
      if (
        containingAnchor !== null &&
        normalizeDiscordAttachmentUrl(containingAnchor.href, windowObject.location.href) !== null
      ) {
        continue;
      }
      if (!isElementVisibleInRect(element, visibleViewport, windowObject)) continue;

      const rawUrl =
        element instanceof HTMLVideoElement
          ? element.currentSrc || element.src
          : element.currentSrc || element.src;
      const url = normalizeDiscordAttachmentUrl(rawUrl, windowObject.location.href);
      if (url === null) continue;

      const kind: MediaKind = element instanceof HTMLVideoElement ? 'video' : 'image';
      const source: CandidateSource = element instanceof HTMLVideoElement ? 'video' : 'image';
      addCandidate(candidatesByIdentity, url, kind, source);
      if (candidatesByIdentity.size >= MAX_CANDIDATES) break;
    }
  }

  return [...candidatesByIdentity.values()];
}

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
