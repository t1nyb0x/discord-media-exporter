import type { MediaKind } from './media';

const DISCORD_CHANNEL_HOST = 'discord.com';
const ALLOWED_ATTACHMENT_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const ATTACHMENT_PATH = /^\/attachments\/\d+\/\d+\/[^/]+$/;

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);

export function isDiscordChannelUrl(input: string): boolean {
  return discordChannelScope(input) !== null;
}

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

export function attachmentIdentity(url: URL): string {
  return url.pathname;
}

export function inferMediaKind(url: URL): MediaKind {
  const filename = url.pathname.split('/').at(-1) ?? '';
  const extension = filename.includes('.') ? (filename.split('.').at(-1) ?? '').toLowerCase() : '';

  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'file';
}

export function isAllowedCandidateUrl(input: string): boolean {
  return normalizeDiscordAttachmentUrl(input) !== null;
}
