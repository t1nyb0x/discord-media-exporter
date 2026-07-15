import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { ZipEntryCandidate } from '../../src/domain/zip-export';
import { buildMediaZip } from '../../src/platform/zip/build-media-zip';

describe('buildMediaZip', () => {
  it('fetches sequentially without credentials and creates a valid ZIP', async () => {
    const entries = [createEntry(1, 'photo.png'), createEntry(2, 'メモ.txt')];
    const contents = [strToU8('image-content'), strToU8('hello')];
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      const index = String(input).includes('/201/') ? 0 : 1;
      await Promise.resolve();
      activeFetches -= 1;
      expect(init).toMatchObject({ credentials: 'omit', redirect: 'follow' });
      return attachmentResponse(contents[index]!, String(input));
    }) as typeof fetch;

    const progress = vi.fn();
    const result = await buildMediaZip(entries, {
      signal: new AbortController().signal,
      fetcher,
      onProgress: progress,
      progressIntervalMs: 0,
    });
    const archiveBytes = new Uint8Array(await result.blob.arrayBuffer());
    const archive = unzipSync(archiveBytes);

    expect(maxActiveFetches).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(strFromU8(archive['photo.png']!)).toBe('image-content');
    expect(strFromU8(archive['メモ.txt']!)).toBe('hello');
    expect(centralDirectoryCrcs(archiveBytes)).toEqual({
      'photo.png': crc32(contents[0]!),
      'メモ.txt': crc32(contents[1]!),
    });
    expect(result.processedBytes).toBe(contents[0]!.length + contents[1]!.length);
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'packing',
      completedItems: 2,
      processedBytes: result.processedBytes,
    });
  });

  it('rejects a redirect outside the approved Discord attachment hosts', async () => {
    const fetcher = vi.fn(async () => attachmentResponse(strToU8('bad'), 'https://example.com/x'));

    await expect(
      buildMediaZip([createEntry(1, 'photo.png')], {
        signal: new AbortController().signal,
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REDIRECT' });
  });

  it('creates a valid empty ZIP entry', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      attachmentResponse(new Uint8Array(), String(input), { 'content-length': '0' }),
    );
    const result = await buildMediaZip([createEntry(1, 'empty.txt')], {
      signal: new AbortController().signal,
      fetcher: fetcher as typeof fetch,
    });
    const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));

    expect(archive['empty.txt']).toHaveLength(0);
    expect(result.processedBytes).toBe(0);
  });

  it('enforces declared and streamed item byte limits', async () => {
    const declaredFetcher = vi.fn(async (input: string | URL | Request) =>
      attachmentResponse(strToU8('small'), String(input), { 'content-length': '6' }),
    );
    await expect(
      buildMediaZip([createEntry(1, 'file.bin')], {
        signal: new AbortController().signal,
        fetcher: declaredFetcher as typeof fetch,
        maxItemBytes: 5,
      }),
    ).rejects.toMatchObject({ code: 'ITEM_TOO_LARGE' });

    const streamedFetcher = vi.fn(async (input: string | URL | Request) =>
      attachmentResponse(strToU8('123456'), String(input)),
    );
    await expect(
      buildMediaZip([createEntry(1, 'file.bin')], {
        signal: new AbortController().signal,
        fetcher: streamedFetcher as typeof fetch,
        maxItemBytes: 5,
      }),
    ).rejects.toMatchObject({ code: 'ITEM_TOO_LARGE' });
  });

  it('enforces the total streamed byte limit and supports cancellation', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      attachmentResponse(strToU8('1234'), String(input)),
    );
    await expect(
      buildMediaZip([createEntry(1, 'one.bin'), createEntry(2, 'two.bin')], {
        signal: new AbortController().signal,
        fetcher: fetcher as typeof fetch,
        maxItemBytes: 10,
        maxTotalBytes: 7,
      }),
    ).rejects.toMatchObject({ code: 'BATCH_TOO_LARGE' });

    const controller = new AbortController();
    controller.abort();
    await expect(
      buildMediaZip([createEntry(1, 'one.bin')], {
        signal: controller.signal,
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function createEntry(index: number, filename: string): ZipEntryCandidate {
  return {
    candidateId: `media-${index}`,
    sourceUrl: `https://cdn.discordapp.com/attachments/111/${200 + index}/${filename}`,
    filename,
  };
}

function attachmentResponse(contents: Uint8Array, url: string, headers?: HeadersInit): Response {
  const response = new Response(
    contents.slice().buffer as ArrayBuffer,
    headers === undefined ? undefined : { headers },
  );
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function centralDirectoryCrcs(archive: Uint8Array): Record<string, number> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const result: Record<string, number> = {};
  for (let offset = 0; offset <= archive.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const filenameLength = view.getUint16(offset + 28, true);
    const filename = decoder.decode(archive.subarray(offset + 46, offset + 46 + filenameLength));
    result[filename] = view.getUint32(offset + 16, true);
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
