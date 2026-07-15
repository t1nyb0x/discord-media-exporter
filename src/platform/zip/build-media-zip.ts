import { Zip, ZipPassThrough } from 'fflate';
import {
  MAX_ZIP_ITEM_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  type ZipEntryCandidate,
  type ZipExportErrorCode,
} from '../../domain/zip-export';
import { normalizeDiscordAttachmentUrl } from '../../domain/url';

const ZIP_MIME_TYPE = 'application/zip';
const ZIP_TIMESTAMP = new Date('1980-01-01T00:00:00.000Z');

export interface ZipBuildProgress {
  phase: 'fetching' | 'packing';
  completedItems: number;
  processedBytes: number;
  currentFilename?: string;
}

interface BuildMediaZipOptions {
  signal: AbortSignal;
  fetcher?: typeof fetch;
  onProgress?: (progress: ZipBuildProgress) => void | Promise<void>;
  maxItemBytes?: number;
  maxTotalBytes?: number;
  progressIntervalMs?: number;
}

export interface BuiltMediaZip {
  blob: Blob;
  processedBytes: number;
}

export async function buildMediaZip(
  entries: ZipEntryCandidate[],
  options: BuildMediaZipOptions,
): Promise<BuiltMediaZip> {
  const fetcher = options.fetcher ?? fetch;
  const maxItemBytes = options.maxItemBytes ?? MAX_ZIP_ITEM_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_ZIP_TOTAL_BYTES;
  const progressIntervalMs = options.progressIntervalMs ?? 200;
  const chunks: BlobPart[] = [];
  let resolveZip!: () => void;
  let rejectZip!: (error: Error) => void;
  const zipFinished = new Promise<void>((resolve, reject) => {
    resolveZip = resolve;
    rejectZip = reject;
  });

  const zip = new Zip((error, data, final) => {
    if (error !== null) {
      rejectZip(error);
      return;
    }
    if (data.length > 0) chunks.push(data.slice().buffer as ArrayBuffer);
    if (final) resolveZip();
  });

  let processedBytes = 0;
  let completedItems = 0;
  let lastProgressAt = 0;

  try {
    for (const entry of entries) {
      assertNotCancelled(options.signal);
      await options.onProgress?.({
        phase: 'fetching',
        completedItems,
        processedBytes,
        currentFilename: entry.filename,
      });

      const response = await fetcher(entry.sourceUrl, {
        credentials: 'omit',
        redirect: 'follow',
        signal: options.signal,
      });
      if (!response.ok) throw new ZipBuildError('FETCH_FAILED', entry.filename);
      if (normalizeDiscordAttachmentUrl(response.url) === null) {
        throw new ZipBuildError('INVALID_REDIRECT', entry.filename);
      }

      const declaredLength = parseContentLength(response.headers.get('content-length'));
      if (declaredLength !== undefined && declaredLength > maxItemBytes) {
        throw new ZipBuildError('ITEM_TOO_LARGE', entry.filename);
      }
      if (declaredLength !== undefined && processedBytes + declaredLength > maxTotalBytes) {
        throw new ZipBuildError('BATCH_TOO_LARGE', entry.filename);
      }

      const zipEntry = new ZipPassThrough(entry.filename);
      zipEntry.mtime = ZIP_TIMESTAMP;
      zip.add(zipEntry);
      const reader = response.body?.getReader();
      if (reader === undefined) throw new ZipBuildError('FETCH_FAILED', entry.filename);

      let itemBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assertNotCancelled(options.signal);
        itemBytes += value.byteLength;
        processedBytes += value.byteLength;
        if (itemBytes > maxItemBytes) {
          await reader.cancel();
          throw new ZipBuildError('ITEM_TOO_LARGE', entry.filename);
        }
        if (processedBytes > maxTotalBytes) {
          await reader.cancel();
          throw new ZipBuildError('BATCH_TOO_LARGE', entry.filename);
        }
        zipEntry.push(value);

        const now = Date.now();
        if (now - lastProgressAt >= progressIntervalMs) {
          lastProgressAt = now;
          await options.onProgress?.({
            phase: 'fetching',
            completedItems,
            processedBytes,
            currentFilename: entry.filename,
          });
        }
      }

      zipEntry.push(new Uint8Array(), true);
      completedItems += 1;
      await options.onProgress?.({
        phase: 'fetching',
        completedItems,
        processedBytes,
        currentFilename: entry.filename,
      });
    }

    await options.onProgress?.({
      phase: 'packing',
      completedItems,
      processedBytes,
    });
    zip.end();
    await zipFinished;
    assertNotCancelled(options.signal);
    return { blob: new Blob(chunks, { type: ZIP_MIME_TYPE }), processedBytes };
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

export class ZipBuildError extends Error {
  constructor(
    readonly code: ZipExportErrorCode,
    readonly filename?: string,
  ) {
    super(code);
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}
