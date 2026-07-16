import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { ZipEntryCandidate } from '../../src/domain/zip-export';
import { buildMediaZip } from '../../src/platform/zip/build-media-zip';

describe('buildMediaZip', () => {
  it('prefetches responses without credentials and writes entries in order', async () => {
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

    expect(maxActiveFetches).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(strFromU8(archive['photo.png']!)).toBe('image-content');
    expect(strFromU8(archive['メモ.txt']!)).toBe('hello');
    expect(centralDirectoryCrcs(archiveBytes)).toEqual({
      'photo.png': crc32(contents[0]!),
      'メモ.txt': crc32(contents[1]!),
    });
    expect(centralDirectoryFilenames(archiveBytes)).toEqual(['photo.png', 'メモ.txt']);
    expect(result.processedBytes).toBe(contents[0]!.length + contents[1]!.length);
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'packing',
      completedItems: 2,
      processedBytes: result.processedBytes,
      outputBytes: expect.any(Number),
    });
    expect(result.outputBytes).toBe(archiveBytes.byteLength);
  });

  it('limits response prefetch to three concurrent requests', async () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      createEntry(index, `file-${index}.bin`),
    );
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await Promise.resolve();
      activeFetches -= 1;
      return attachmentResponse(strToU8('x'), String(input));
    });

    await buildMediaZip(entries, {
      signal: new AbortController().signal,
      fetcher: fetcher as typeof fetch,
    });

    expect(maxActiveFetches).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(entries.length);
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

  it('reports a network request exception as a fetch failure', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('network unavailable');
    });

    await expect(
      buildMediaZip([createEntry(1, 'photo.png')], {
        signal: new AbortController().signal,
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED', filename: 'photo.png' });
  });

  it('reports a response stream exception as a fetch failure', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError('connection reset'));
      },
    });
    const response = new Response(stream);
    Object.defineProperty(response, 'url', {
      value: 'https://cdn.discordapp.com/attachments/111/201/photo.png',
    });

    await expect(
      buildMediaZip([createEntry(1, 'photo.png')], {
        signal: new AbortController().signal,
        fetcher: vi.fn(async () => response) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED', filename: 'photo.png' });
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

  it('processes all 500 collected candidates without a ZIP item cap', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      attachmentResponse(strToU8('x'), String(input)),
    );
    const entries = Array.from({ length: 500 }, (_, index) =>
      createEntry(index, `file-${index}.bin`),
    );
    const result = await buildMediaZip(entries, {
      signal: new AbortController().signal,
      fetcher: fetcher as typeof fetch,
    });
    const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));

    expect(Object.keys(archive)).toHaveLength(500);
    expect(result.processedBytes).toBe(500);
  });

  it('supports cancellation', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      attachmentResponse(strToU8('1234'), String(input)),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildMediaZip([createEntry(1, 'one.bin')], {
        signal: controller.signal,
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps OPFS quota failures without saving a partial archive', async () => {
    const abort = vi.fn(async () => undefined);
    const sink = {
      write: vi.fn(async () => {
        throw new DOMException('quota', 'QuotaExceededError');
      }),
      close: vi.fn(),
      abort,
    };
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      attachmentResponse(strToU8('data'), String(input)),
    );

    await expect(
      buildMediaZip([createEntry(1, 'one.bin')], {
        signal: new AbortController().signal,
        fetcher: fetcher as typeof fetch,
        sink,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
    expect(abort).toHaveBeenCalledOnce();
    expect(sink.close).not.toHaveBeenCalled();
  });

  it.each(['write', 'close'] as const)(
    'maps a generic OPFS %s failure without saving a partial archive',
    async (failurePoint) => {
      const abort = vi.fn(async () => undefined);
      const sink = {
        write: vi.fn(async () => {
          if (failurePoint === 'write') throw new Error('write failed');
        }),
        close: vi.fn(async () => {
          if (failurePoint === 'close') throw new Error('close failed');
          return new Blob();
        }),
        abort,
      };
      const fetcher = vi.fn(async (input: string | URL | Request) =>
        attachmentResponse(strToU8('data'), String(input)),
      );

      await expect(
        buildMediaZip([createEntry(1, 'one.bin')], {
          signal: new AbortController().signal,
          fetcher: fetcher as typeof fetch,
          sink,
        }),
      ).rejects.toMatchObject({ code: 'TEMP_WRITE_FAILED' });
      expect(abort).toHaveBeenCalledOnce();
    },
  );

  it('cancels the active and prefetched response bodies after a write failure', async () => {
    const cancelledIndexes = new Set<number>();
    const entries = Array.from({ length: 3 }, (_, index) =>
      createEntry(index, `file-${index}.bin`),
    );
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const match = String(input).match(/file-(\d+)\.bin/);
      const index = Number(match?.[1] ?? -1);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(strToU8(`data-${index}`));
        },
        cancel() {
          cancelledIndexes.add(index);
        },
      });
      const response = new Response(stream);
      Object.defineProperty(response, 'url', { value: String(input) });
      return response;
    });
    let writes = 0;
    const sink = {
      async write() {
        writes += 1;
        if (writes === 2) throw new Error('write failed');
      },
      async close() {
        return new Blob();
      },
      async abort() {},
    };

    await expect(
      buildMediaZip(entries, {
        signal: new AbortController().signal,
        fetcher: fetcher as typeof fetch,
        sink,
      }),
    ).rejects.toMatchObject({ code: 'TEMP_WRITE_FAILED' });

    expect(cancelledIndexes).toEqual(new Set([0, 1, 2]));
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

function centralDirectoryFilenames(archive: Uint8Array): string[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const result: string[] = [];
  for (let offset = 0; offset <= archive.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const filenameLength = view.getUint16(offset + 28, true);
    result.push(decoder.decode(archive.subarray(offset + 46, offset + 46 + filenameLength)));
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
