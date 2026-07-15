import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import {
  getDownloadState,
  getCandidateCollection,
  clearCandidateCollection,
  getRegisteredCandidates,
  handleDownloadChanged,
  hasActiveDownloads,
  registerCandidates,
  startDownloads,
} from '../src/platform/chrome/download-manager';
import {
  cancelZipExport,
  getZipExportState,
  handleZipBackgroundEvent,
  handleZipDownloadChanged,
  hasActiveZipExport,
  startZipExport,
} from '../src/platform/chrome/zip-export-manager';
import { isExtensionRequest } from '../src/shared/messages';
import { isOffscreenZipRequest, isZipBackgroundEvent } from '../src/shared/zip-messages';

const OFFSCREEN_URL = `chrome-extension://${browser.runtime.id}/offscreen.html`;

export default defineBackground(() => {
  browser.downloads.onChanged.addListener((delta) => {
    void handleDownloadChanged(delta);
    void handleZipDownloadChanged(delta);
  });

  browser.runtime.onMessage.addListener(async (message, sender): Promise<unknown> => {
    if (isOffscreenZipRequest(message)) return undefined;
    if (isZipBackgroundEvent(message)) {
      if (sender.id !== browser.runtime.id || sender.url !== OFFSCREEN_URL) return undefined;
      await handleZipBackgroundEvent(message);
      return { ok: true };
    }

    if (sender.id !== browser.runtime.id || !isExtensionRequest(message)) {
      return { ok: false, error: '不正なリクエストです。' };
    }

    try {
      switch (message.type) {
        case 'REGISTER_SCAN_RESULT': {
          const collection = await registerCandidates(message.candidates, message.scope);
          return { ok: true, type: 'SCAN_REGISTERED', collection };
        }
        case 'GET_SCAN_COLLECTION': {
          const collection = await getCandidateCollection(message.scope);
          return { ok: true, type: 'SCAN_COLLECTION', collection };
        }
        case 'CLEAR_SCAN_COLLECTION': {
          if (await hasActiveZipExport()) throw new Error('ZIP出力の完了後にクリアしてください。');
          const collection = await clearCandidateCollection(message.scope);
          return { ok: true, type: 'SCAN_COLLECTION_CLEARED', collection };
        }
        case 'START_DOWNLOADS': {
          if (await hasActiveZipExport()) throw new Error('ZIP出力の完了後に保存してください。');
          const state = await startDownloads(message.candidateIds);
          return { ok: true, type: 'DOWNLOADS_STARTED', state };
        }
        case 'GET_DOWNLOAD_STATUS': {
          const state = await getDownloadState();
          return { ok: true, type: 'DOWNLOAD_STATUS', state };
        }
        case 'START_ZIP_EXPORT': {
          if (await hasActiveDownloads()) {
            throw new Error('個別ダウンロードの完了後にZIPを作成してください。');
          }
          const candidates = await getRegisteredCandidates(message.candidateIds);
          const state = await startZipExport(candidates);
          return { ok: true, type: 'ZIP_EXPORT_STARTED', state };
        }
        case 'CANCEL_ZIP_EXPORT': {
          const state = await cancelZipExport();
          return { ok: true, type: 'ZIP_EXPORT_CANCELLED', state };
        }
        case 'GET_EXPORT_STATUS': {
          const state = await getZipExportState();
          return { ok: true, type: 'ZIP_EXPORT_STATUS', state };
        }
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '処理に失敗しました。',
      };
    }
  });
});
