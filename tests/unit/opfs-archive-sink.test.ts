import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupOrphanedOpfsArchives,
  createOpfsArchiveSink,
} from '../../src/platform/zip/opfs-archive-sink';

describe('OPFS archive sink', () => {
  const originalStorage = navigator.storage;

  afterEach(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: originalStorage });
  });

  it('writes, closes, exposes a File, and removes the temporary archive', async () => {
    const writes: ArrayBuffer[] = [];
    const removeEntry = vi.fn(async () => undefined);
    const writable = {
      write: vi.fn(async (chunk: ArrayBuffer) => writes.push(chunk)),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    const file = new File(['zip'], 'temporary.zip', { type: 'application/zip' });
    installStorageMock({
      getFileHandle: vi.fn(async () => ({
        createWritable: vi.fn(async () => writable),
        getFile: vi.fn(async () => file),
      })),
      removeEntry,
      entries: async function* () {},
    });

    const sink = await createOpfsArchiveSink('job-123');
    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.write(new Uint8Array([4, 5]));
    expect(writable.write).not.toHaveBeenCalled();
    expect(await sink.close()).toBe(file);
    await sink.remove();

    expect(writes).toHaveLength(1);
    expect(new Uint8Array(writes[0]!)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(writable.close).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalledWith('dme-zip-job-123.zip.part');
  });

  it('aborts the writable and removes the temporary archive', async () => {
    const removeEntry = vi.fn(async () => undefined);
    const writable = {
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    installStorageMock({
      getFileHandle: vi.fn(async () => ({
        createWritable: vi.fn(async () => writable),
        getFile: vi.fn(),
      })),
      removeEntry,
      entries: async function* () {},
    });

    const sink = await createOpfsArchiveSink('job-456');
    await sink.abort();

    expect(writable.abort).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalledWith('dme-zip-job-456.zip.part');
  });

  it('removes only orphaned extension ZIP temporary files', async () => {
    const removeEntry = vi.fn(async () => undefined);
    installStorageMock({
      getFileHandle: vi.fn(),
      removeEntry,
      entries: async function* () {
        yield ['dme-zip-old.zip.part', {}];
        yield ['unrelated.txt', {}];
      },
    });

    await cleanupOrphanedOpfsArchives();

    expect(removeEntry).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalledWith('dme-zip-old.zip.part', { recursive: false });
  });
});

function installStorageMock(root: Record<string, unknown>): void {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: vi.fn(async () => root) },
  });
}
