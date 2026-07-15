import { describe, expect, it } from 'vitest';
import {
  attachmentIdentity,
  inferMediaKind,
  isDiscordChannelUrl,
  normalizeDiscordAttachmentUrl,
} from '../../src/domain/url';

describe('Discord URL validation', () => {
  it('accepts a Discord channel URL', () => {
    expect(isDiscordChannelUrl('https://discord.com/channels/1/2')).toBe(true);
  });

  it('rejects lookalike and non-channel URLs', () => {
    expect(isDiscordChannelUrl('https://discord.com.evil.test/channels/1/2')).toBe(false);
    expect(isDiscordChannelUrl('https://discord.com/app')).toBe(false);
  });

  it('accepts only HTTPS Discord attachment paths', () => {
    expect(
      normalizeDiscordAttachmentUrl('https://cdn.discordapp.com/attachments/1/2/photo.png'),
    ).not.toBeNull();
    expect(
      normalizeDiscordAttachmentUrl(
        'https://media.discordapp.net/attachments/1/2/photo.png?width=400',
      ),
    ).not.toBeNull();
    expect(normalizeDiscordAttachmentUrl('https://cdn.discordapp.com/assets/app.js')).toBeNull();
    expect(
      normalizeDiscordAttachmentUrl('https://example.com/attachments/1/2/photo.png'),
    ).toBeNull();
    expect(
      normalizeDiscordAttachmentUrl('http://cdn.discordapp.com/attachments/1/2/photo.png'),
    ).toBeNull();
  });

  it('uses the attachment path as the deduplication identity', () => {
    const cdn = new URL('https://cdn.discordapp.com/attachments/1/2/photo.png?ex=1');
    const proxy = new URL('https://media.discordapp.net/attachments/1/2/photo.png?width=400');
    expect(attachmentIdentity(cdn)).toBe(attachmentIdentity(proxy));
  });

  it('infers common media kinds from extensions', () => {
    expect(inferMediaKind(new URL('https://cdn.discordapp.com/attachments/1/2/photo.webp'))).toBe(
      'image',
    );
    expect(inferMediaKind(new URL('https://cdn.discordapp.com/attachments/1/2/movie.mp4'))).toBe(
      'video',
    );
    expect(inferMediaKind(new URL('https://cdn.discordapp.com/attachments/1/2/archive.zip'))).toBe(
      'file',
    );
  });
});
