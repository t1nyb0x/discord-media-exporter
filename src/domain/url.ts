import type { MediaKind } from './media';

const DISCORD_CHANNEL_HOST = 'discord.com';
const ALLOWED_ATTACHMENT_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const ATTACHMENT_PATH = /^\/attachments\/\d+\/\d+\/[^/]+$/;

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);

/** Reports whether the input identifies a Discord channel page. */
export function isDiscordChannelUrl(input: string): boolean {
  return discordChannelScope(input) !== null;
}

/** Returns the stable channel-page scope for a supported Discord URL. */
export function discordChannelScope(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== DISCORD_CHANNEL_HOST ||
      !url.pathname.startsWith('/channels/')
    ) {
      return null;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/** Resolves and validates a Discord CDN attachment URL against the allowlist. */
export function normalizeDiscordAttachmentUrl(input: string, baseUrl?: string): URL | null {
  try {
    const url = baseUrl === undefined ? new URL(input) : new URL(input, baseUrl);
    if (url.protocol !== 'https:') return null;
    if (!ALLOWED_ATTACHMENT_HOSTS.has(url.hostname)) return null;
    if (!ATTACHMENT_PATH.test(url.pathname)) return null;

    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

/** Returns the signature-independent path used to deduplicate an attachment. */
export function attachmentIdentity(url: URL): string {
  return url.pathname;
}

/** Infers the media category from an attachment filename extension. */
export function inferMediaKind(url: URL): MediaKind {
  const filename = url.pathname.split('/').at(-1) ?? '';
  const extension = filename.includes('.') ? (filename.split('.').at(-1) ?? '').toLowerCase() : '';

  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'file';
}

/** Reports whether an input is a supported Discord CDN attachment URL. */
export function isAllowedCandidateUrl(input: string): boolean {
  return normalizeDiscordAttachmentUrl(input) !== null;
}
