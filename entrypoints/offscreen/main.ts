import { browser } from 'wxt/browser';
import type { ZipEntryCandidate, ZipExportErrorCode } from '../../src/domain/zip-export';
import {
  buildMediaZip,
  ZipBuildError,
  type ZipBuildProgress,
} from '../../src/platform/zip/build-media-zip';
import {
  cleanupOrphanedOpfsArchives,
  createOpfsArchiveSink,
  type TemporaryZipArchiveSink,
} from '../../src/platform/zip/opfs-archive-sink';
import { isOffscreenZipRequest, type ZipBackgroundEvent } from '../../src/shared/zip-messages';

const PROGRESS_REPORT_INTERVAL_MS = 500;

interface ActiveJob {
  jobId: string;
  controller: AbortController;
}

let activeJob: ActiveJob | undefined;
const artifacts = new Map<string, { blobUrl: string; sink: TemporaryZipArchiveSink }>();

const orphanCleanup = cleanupOrphanedOpfsArchives().catch(() => undefined);

browser.runtime.onMessage.addListener(async (message, sender): Promise<unknown> => {
  if (sender.id !== browser.runtime.id || !isOffscreenZipRequest(message)) return undefined;

  switch (message.type) {
    case 'CREATE_ZIP':
      if (activeJob !== undefined) return { accepted: false };
      activeJob = { jobId: message.jobId, controller: new AbortController() };
      void createZip(activeJob, message.entries);
      return { accepted: true };
    case 'CANCEL_ZIP':
      if (activeJob?.jobId === message.jobId) {
        activeJob.controller.abort();
      }
      return { accepted: true };
    case 'REVOKE_ZIP': {
      const artifact = artifacts.get(message.jobId);
      if (artifact !== undefined) {
        URL.revokeObjectURL(artifact.blobUrl);
        await artifact.sink.remove().catch(() => undefined);
        artifacts.delete(message.jobId);
      }
      return { accepted: true };
    }
  }
});

/** Builds one ZIP job, publishes its artifact, and cleans up failures. */
async function createZip(job: ActiveJob, entries: ZipEntryCandidate[]): Promise<void> {
  let currentFilename: string | undefined;
  let sink: TemporaryZipArchiveSink | undefined;
  const progressReporter = createProgressReporter(job.jobId);
  try {
    await orphanCleanup;
    sink = await createOpfsArchiveSink(job.jobId);
    const result = await buildMediaZip(entries, {
      signal: job.controller.signal,
      sink,
      onProgress: (progress) => {
        currentFilename = progress.currentFilename;
        progressReporter.report(progress);
      },
    });
    await progressReporter.flush();
    const blob = result.blob;
    const blobUrl = URL.createObjectURL(blob);
    artifacts.set(job.jobId, { blobUrl, sink });
    await postBackgroundEvent({
      target: 'background',
      type: 'ZIP_READY',
      jobId: job.jobId,
      blobUrl,
      processedBytes: result.processedBytes,
      outputBytes: result.outputBytes,
    });
  } catch (error) {
    await progressReporter.flush();
    if (sink !== undefined && !artifacts.has(job.jobId)) {
      await sink.abort().catch(() => undefined);
    }
    const cancelled = job.controller.signal.aborted;
    const code = zipFailureCode(error, sink !== undefined);
    const failedEvent: ZipBackgroundEvent = {
      target: 'background',
      type: 'ZIP_FAILED',
      jobId: job.jobId,
      code,
      cancelled,
    };
    if (currentFilename !== undefined) failedEvent.filename = currentFilename;
    await postBackgroundEvent(failedEvent);
  } finally {
    progressReporter.dispose();
    if (activeJob?.jobId === job.jobId) activeJob = undefined;
  }
}

/** Creates a throttled, ordered progress sender for one ZIP job. */
function createProgressReporter(jobId: string): {
  report(progress: ZipBuildProgress): void;
  flush(): Promise<void>;
  dispose(): void;
} {
  let latest: ZipBuildProgress | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sendChain = Promise.resolve();

  return {
    report(progress) {
      latest = progress;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void sendLatest().catch(() => undefined);
      }, PROGRESS_REPORT_INTERVAL_MS);
    },
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await sendLatest().catch(() => undefined);
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      latest = undefined;
    },
  };

  /** Sends the latest pending progress after earlier sends settle. */
  function sendLatest(): Promise<void> {
    const progress = latest;
    latest = undefined;
    if (progress === undefined) return sendChain;
    sendChain = sendChain.catch(() => undefined).then(() => postProgress(jobId, progress));
    return sendChain;
  }
}

/** Converts ZIP build progress into a background event. */
async function postProgress(jobId: string, progress: ZipBuildProgress): Promise<void> {
  const event: ZipBackgroundEvent = {
    target: 'background',
    type: 'ZIP_PROGRESS',
    jobId,
    phase: progress.phase,
    completedItems: progress.completedItems,
    processedBytes: progress.processedBytes,
    outputBytes: progress.outputBytes,
  };
  if (progress.currentFilename !== undefined) event.currentFilename = progress.currentFilename;
  await postBackgroundEvent(event);
}

/** Sends one typed ZIP event to the background service worker. */
async function postBackgroundEvent(event: ZipBackgroundEvent): Promise<void> {
  await browser.runtime.sendMessage(event);
}

/** Maps an offscreen failure to the narrow ZIP error taxonomy. */
function zipFailureCode(error: unknown, sinkCreated: boolean): ZipExportErrorCode {
  if (error instanceof ZipBuildError) return error.code;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'STORAGE_QUOTA_EXCEEDED';
  }
  return sinkCreated ? 'ZIP_FAILED' : 'TEMP_WRITE_FAILED';
}
