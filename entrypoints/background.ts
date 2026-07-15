import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import {
  getDownloadState,
  handleDownloadChanged,
  registerCandidates,
  startDownloads,
} from '../src/platform/chrome/download-manager';
import { isExtensionRequest, type ExtensionResponse } from '../src/shared/messages';

export default defineBackground(() => {
  browser.downloads.onChanged.addListener((delta) => {
    void handleDownloadChanged(delta);
  });

  browser.runtime.onMessage.addListener(async (message, sender): Promise<ExtensionResponse> => {
    if (sender.id !== browser.runtime.id || !isExtensionRequest(message)) {
      return { ok: false, error: '不正なリクエストです。' };
    }

    try {
      switch (message.type) {
        case 'REGISTER_SCAN_RESULT': {
          const count = await registerCandidates(message.candidates);
          return { ok: true, type: 'SCAN_REGISTERED', count };
        }
        case 'START_DOWNLOADS': {
          const state = await startDownloads(message.candidateIds);
          return { ok: true, type: 'DOWNLOADS_STARTED', state };
        }
        case 'GET_DOWNLOAD_STATUS': {
          const state = await getDownloadState();
          return { ok: true, type: 'DOWNLOAD_STATUS', state };
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
