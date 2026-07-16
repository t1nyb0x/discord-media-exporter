import type { ZipArchiveSink } from './zip64-store-writer';

const TEMP_ARCHIVE_PREFIX = 'dme-zip-';
const TEMP_ARCHIVE_SUFFIX = '.zip.part';
const OPFS_WRITE_BUFFER_BYTES = 1024 * 1024;

export interface TemporaryZipArchiveSink extends ZipArchiveSink {
  remove(): Promise<void>;
}

export interface OrphanedArchiveCleanupResult {
  removed: number;
  failed: number;
}

export async function createOpfsArchiveSink(jobId: string): Promise<TemporaryZipArchiveSink> {
  const root = await navigator.storage.getDirectory();
  const filename = temporaryArchiveFilename(jobId);
  const handle = await root.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  let closed = false;
  let removed = false;
  let bufferedChunks: Uint8Array[] = [];
  let bufferedBytes = 0;

  return {
    async write(chunk) {
      if (closed || removed) throw new Error('Temporary ZIP is not writable.');
      if (chunk.byteLength === 0) return;
      bufferedChunks.push(chunk);
      bufferedBytes += chunk.byteLength;
      if (bufferedBytes >= OPFS_WRITE_BUFFER_BYTES) await flush();
    },
    async close() {
      if (removed) throw new Error('Temporary ZIP was removed.');
      if (!closed) {
        await flush();
        await writable.close();
        closed = true;
      }
      const file = await handle.getFile();
      return file.type === 'application/zip' ? file : new Blob([file], { type: 'application/zip' });
    },
    async abort() {
      bufferedChunks = [];
      bufferedBytes = 0;
      if (!closed) {
        await writable.abort().catch(() => undefined);
        closed = true;
      }
      await remove();
    },
    remove,
  };

  async function remove(): Promise<void> {
    if (removed) return;
    removed = true;
    await root.removeEntry(filename).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      throw error;
    });
  }

  async function flush(): Promise<void> {
    if (bufferedBytes === 0) return;
    const output = new Uint8Array(bufferedBytes);
    let offset = 0;
    for (const chunk of bufferedChunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    bufferedChunks = [];
    bufferedBytes = 0;
    await writable.write(output.buffer);
  }
}

export async function cleanupOrphanedOpfsArchives(): Promise<OrphanedArchiveCleanupResult> {
  const root = await navigator.storage.getDirectory();
  const result = { removed: 0, failed: 0 };
  for await (const [name] of root.entries()) {
    if (!name.startsWith(TEMP_ARCHIVE_PREFIX) || !name.endsWith(TEMP_ARCHIVE_SUFFIX)) continue;
    try {
      await root.removeEntry(name, { recursive: false });
      result.removed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

function temporaryArchiveFilename(jobId: string): string {
  const safeJobId = jobId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80);
  if (safeJobId.length === 0) throw new Error('ZIP job ID is invalid.');
  return `${TEMP_ARCHIVE_PREFIX}${safeJobId}${TEMP_ARCHIVE_SUFFIX}`;
}
