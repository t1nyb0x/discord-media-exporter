import { strFromU8, strToU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZipEntryCandidate } from '../../src/domain/zip-export';
import { buildMediaZip } from '../../src/platform/zip/build-media-zip';
import { createOpfsArchiveSink } from '../../src/platform/zip/opfs-archive-sink';

describe('OPFS ZIP pipeline', () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: originalStorage });
  });

  it('streams 101 fetched entries through OPFS and exposes a downloadable File', async () => {
    const writtenChunks: ArrayBuffer[] = [];
    const removeEntry = vi.fn(async () => undefined);
    const writable = {
      write: vi.fn(async (chunk: ArrayBuffer) => {
        writtenChunks.push(chunk.slice(0));
      }),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    const fileHandle = {
      createWritable: vi.fn(async () => writable),
      getFile: vi.fn(async () => new File(writtenChunks, 'archive.zip')),
    };
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn(async () => ({
          getFileHandle: vi.fn(async () => fileHandle),
          removeEntry,
          entries: async function* () {},
        })),
      },
    });
    const entries = Array.from({ length: 101 }, (_, index): ZipEntryCandidate => {
      const filename = `file-${index}.txt`;
      return {
        candidateId: `candidate-${index}`,
        sourceUrl: `https://cdn.discordapp.com/attachments/111/${200 + index}/${filename}`,
        filename,
      };
    });
    const sink = await createOpfsArchiveSink('pipeline');
    const result = await buildMediaZip(entries, {
      signal: new AbortController().signal,
      sink,
      fetcher: vi.fn(async (input: string | URL | Request) => {
        const response = new Response(strToU8(`content:${String(input).split('/').at(-1)}`));
        Object.defineProperty(response, 'url', { value: String(input) });
        return response;
      }) as typeof fetch,
    });
    const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));

    expect(result.blob.type).toBe('application/zip');
    expect(Object.keys(archive)).toHaveLength(101);
    expect(strFromU8(archive['file-100.txt']!)).toBe('content:file-100.txt');
    expect(writable.write).toHaveBeenCalled();
    expect(writable.close).toHaveBeenCalledOnce();

    await sink.remove();
    expect(removeEntry).toHaveBeenCalledWith('dme-zip-pipeline.zip.part');
  });
});
