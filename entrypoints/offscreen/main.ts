import { browser } from 'wxt/browser';
import type { ZipEntryCandidate } from '../../src/domain/zip-export';
import {
  buildMediaZip,
  ZipBuildError,
  type ZipBuildProgress,
} from '../../src/platform/zip/build-media-zip';
import { isOffscreenZipRequest, type ZipBackgroundEvent } from '../../src/shared/zip-messages';

interface ActiveJob {
  jobId: string;
  controller: AbortController;
}

let activeJob: ActiveJob | undefined;
const blobUrls = new Map<string, string>();

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
      const blobUrl = blobUrls.get(message.jobId);
      if (blobUrl !== undefined) {
        URL.revokeObjectURL(blobUrl);
        blobUrls.delete(message.jobId);
      }
      return { accepted: true };
    }
  }
});

async function createZip(job: ActiveJob, entries: ZipEntryCandidate[]): Promise<void> {
  let currentFilename: string | undefined;
  try {
    const result = await buildMediaZip(entries, {
      signal: job.controller.signal,
      onProgress: async (progress) => {
        currentFilename = progress.currentFilename;
        await postProgress(job.jobId, progress);
      },
    });
    const blob = result.blob;
    const blobUrl = URL.createObjectURL(blob);
    blobUrls.set(job.jobId, blobUrl);
    await postBackgroundEvent({
      target: 'background',
      type: 'ZIP_READY',
      jobId: job.jobId,
      blobUrl,
      processedBytes: result.processedBytes,
    });
  } catch (error) {
    const cancelled = job.controller.signal.aborted;
    const code = error instanceof ZipBuildError ? error.code : 'ZIP_FAILED';
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
    if (activeJob?.jobId === job.jobId) activeJob = undefined;
  }
}

async function postProgress(jobId: string, progress: ZipBuildProgress): Promise<void> {
  const event: ZipBackgroundEvent = {
    target: 'background',
    type: 'ZIP_PROGRESS',
    jobId,
    phase: progress.phase,
    completedItems: progress.completedItems,
    processedBytes: progress.processedBytes,
  };
  if (progress.currentFilename !== undefined) event.currentFilename = progress.currentFilename;
  await postBackgroundEvent(event);
}

async function postBackgroundEvent(event: ZipBackgroundEvent): Promise<void> {
  await browser.runtime.sendMessage(event);
}
