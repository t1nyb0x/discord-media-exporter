// The range intentionally removes ASCII control characters from filesystem names.
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SEPARATOR = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;
const TRAILING_DOTS_OR_SPACES = /[. ]+$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_FILENAME_LENGTH = 180;

export function filenameFromUrl(url: URL): string {
  const encoded = url.pathname.split('/').at(-1) ?? '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function sanitizeFilename(input: string, fallback = 'discord-media'): string {
  let value = input
    .normalize('NFC')
    .replace(CONTROL_OR_SEPARATOR, '_')
    .replace(/\.\.+/g, '_')
    .trim()
    .replace(TRAILING_DOTS_OR_SPACES, '');

  if (!value || value === '.' || value === '..') value = fallback;
  if (WINDOWS_RESERVED.test(value)) value = `_${value}`;
  if (value.length <= MAX_FILENAME_LENGTH) return value;

  const dotIndex = value.lastIndexOf('.');
  const hasExtension = dotIndex > 0 && value.length - dotIndex <= 16;
  if (!hasExtension)
    return value.slice(0, MAX_FILENAME_LENGTH).replace(TRAILING_DOTS_OR_SPACES, '');

  const extension = value.slice(dotIndex);
  const basenameLength = MAX_FILENAME_LENGTH - extension.length;
  return `${value.slice(0, basenameLength).replace(TRAILING_DOTS_OR_SPACES, '')}${extension}`;
}
