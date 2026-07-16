import type { ZipEntryCandidate, ZipExportErrorCode } from '../../domain/zip-export';
import { normalizeDiscordAttachmentUrl } from '../../domain/url';
import { MemoryZipArchiveSink, Zip64StoreWriter, type ZipArchiveSink } from './zip64-store-writer';

const DEFAULT_FETCH_CONCURRENCY = 3;

export interface ZipBuildProgress {
  phase: 'fetching' | 'packing';
  completedItems: number;
  processedBytes: number;
  outputBytes: number;
  currentFilename?: string;
}

interface BuildMediaZipOptions {
  signal: AbortSignal;
  sink?: ZipArchiveSink;
  fetcher?: typeof fetch;
  onProgress?: (progress: ZipBuildProgress) => void | Promise<void>;
  progressIntervalMs?: number;
  fetchConcurrency?: number;
}

export interface BuiltMediaZip {
  blob: Blob;
  processedBytes: number;
  outputBytes: number;
}

export async function buildMediaZip(
  entries: ZipEntryCandidate[],
  options: BuildMediaZipOptions,
): Promise<BuiltMediaZip> {
  const fetcher = options.fetcher ?? fetch;
  const progressIntervalMs = options.progressIntervalMs ?? 200;
  const fetchConcurrency = clampConcurrency(options.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY);
  const writer = new Zip64StoreWriter(options.sink ?? new MemoryZipArchiveSink());
  const fetchController = new AbortController();
  const abortFetches = () => fetchController.abort(options.signal.reason);
  if (options.signal.aborted) abortFetches();
  else options.signal.addEventListener('abort', abortFetches, { once: true });
  const pendingResponses = new Map<number, Promise<PrefetchedResponse>>();
  let processedBytes = 0;
  let completedItems = 0;
  let lastProgressAt = 0;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    for (let index = 0; index < Math.min(fetchConcurrency, entries.length); index += 1) {
      schedulePrefetch(index);
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      assertNotCancelled(options.signal);
      await options.onProgress?.({
        phase: 'fetching',
        completedItems,
        processedBytes,
        outputBytes: toSafeNumber(writer.getOutputBytes()),
        currentFilename: entry.filename,
      });

      const prefetched = await pendingResponses.get(index)!;
      pendingResponses.delete(index);
      if (!prefetched.ok) throw prefetched.error;
      activeReader = prefetched.response.body!.getReader();
      const zipEntry = await writer.startEntry(entry.filename);

      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await activeReader.read();
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new ZipBuildError('FETCH_FAILED', entry.filename);
        }
        const { done, value } = readResult;
        if (done) break;
        assertNotCancelled(options.signal);
        processedBytes += value.byteLength;
        await zipEntry.write(value);

        const now = Date.now();
        if (now - lastProgressAt >= progressIntervalMs) {
          lastProgressAt = now;
          await options.onProgress?.({
            phase: 'fetching',
            completedItems,
            processedBytes,
            outputBytes: toSafeNumber(writer.getOutputBytes()),
            currentFilename: entry.filename,
          });
        }
      }

      activeReader = undefined;
      await zipEntry.close();
      completedItems += 1;
      await options.onProgress?.({
        phase: 'fetching',
        completedItems,
        processedBytes,
        outputBytes: toSafeNumber(writer.getOutputBytes()),
        currentFilename: entry.filename,
      });

      const nextIndex = index + fetchConcurrency;
      if (nextIndex < entries.length) schedulePrefetch(nextIndex);
    }

    await options.onProgress?.({
      phase: 'packing',
      completedItems,
      processedBytes,
      outputBytes: toSafeNumber(writer.getOutputBytes()),
    });
    const result = await writer.finalize();
    assertNotCancelled(options.signal);
    return {
      blob: result.blob,
      processedBytes,
      outputBytes: toSafeNumber(result.outputBytes),
    };
  } catch (error) {
    fetchController.abort();
    await activeReader?.cancel().catch(() => undefined);
    await cancelPendingResponses(pendingResponses);
    await writer.abort().catch(() => undefined);
    if (error instanceof ZipBuildError || isAbortError(error)) throw error;
    if (isQuotaExceededError(error)) throw new ZipBuildError('STORAGE_QUOTA_EXCEEDED');
    throw new ZipBuildError('TEMP_WRITE_FAILED');
  } finally {
    options.signal.removeEventListener('abort', abortFetches);
  }

  function schedulePrefetch(index: number): void {
    pendingResponses.set(index, prefetchResponse(entries[index]!, fetcher, fetchController.signal));
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

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

function toSafeNumber(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

type PrefetchedResponse =
  { ok: true; response: Response } | { ok: false; error: ZipBuildError | DOMException };

async function prefetchResponse(
  entry: ZipEntryCandidate,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<PrefetchedResponse> {
  let response: Response;
  try {
    response = await fetcher(entry.sourceUrl, {
      credentials: 'omit',
      redirect: 'follow',
      signal,
    });
  } catch (error) {
    return {
      ok: false,
      error: isAbortError(error) ? error : new ZipBuildError('FETCH_FAILED', entry.filename),
    };
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, error: new ZipBuildError('FETCH_FAILED', entry.filename) };
  }
  if (normalizeDiscordAttachmentUrl(response.url) === null) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, error: new ZipBuildError('INVALID_REDIRECT', entry.filename) };
  }
  if (response.body === null) {
    return { ok: false, error: new ZipBuildError('FETCH_FAILED', entry.filename) };
  }
  return { ok: true, response };
}

async function cancelPendingResponses(
  pendingResponses: Map<number, Promise<PrefetchedResponse>>,
): Promise<void> {
  const responses = await Promise.all(pendingResponses.values());
  pendingResponses.clear();
  await Promise.all(
    responses.map(async (prefetched) => {
      if (prefetched.ok) await prefetched.response.body?.cancel().catch(() => undefined);
    }),
  );
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FETCH_CONCURRENCY;
  return Math.min(DEFAULT_FETCH_CONCURRENCY, Math.max(1, Math.floor(value)));
}
