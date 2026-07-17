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
import {
  disableDiscordLauncher,
  hasDiscordLauncherPermission,
  reconcileDiscordLauncherRegistration,
} from '../src/platform/chrome/discord-launcher-registration';
import { DISCORD_PAGE_ORIGIN } from '../src/shared/permissions';
import {
  isExtensionRequest,
  type ExtensionRequest,
  type ExtensionResponse,
} from '../src/shared/messages';
import { isOffscreenZipRequest, isZipBackgroundEvent } from '../src/shared/zip-messages';
import { DomainError, userFacingError } from '../src/domain/errors';

const OFFSCREEN_URL = `chrome-extension://${browser.runtime.id}/offscreen.html`;

export default defineBackground(() => {
  void reconcileDiscordLauncherRegistration().catch(() => undefined);
  browser.runtime.onStartup.addListener(() => {
    void reconcileDiscordLauncherRegistration().catch(() => undefined);
  });
  browser.runtime.onInstalled.addListener(() => {
    void reconcileDiscordLauncherRegistration(true).catch(() => undefined);
  });
  browser.permissions.onAdded.addListener((permissions) => {
    if (!permissions.origins?.includes(DISCORD_PAGE_ORIGIN)) return;
    void reconcileDiscordLauncherRegistration().catch(() => undefined);
  });
  browser.permissions.onRemoved.addListener((permissions) => {
    if (!permissions.origins?.includes(DISCORD_PAGE_ORIGIN)) return;
    void reconcileDiscordLauncherRegistration(false, true).catch(() => undefined);
  });

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
      return { ok: false, error: { code: 'INVALID_REQUEST' } };
    }
    return dispatchExtensionRequest(message);
  });
});

/** Dispatches one validated extension request to its owning platform service. */
async function dispatchExtensionRequest(message: ExtensionRequest): Promise<ExtensionResponse> {
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
        if (await hasActiveZipExport()) throw new DomainError({ code: 'ZIP_ACTIVE_CLEAR' });
        const collection = await clearCandidateCollection(message.scope);
        return { ok: true, type: 'SCAN_COLLECTION_CLEARED', collection };
      }
      case 'START_DOWNLOADS': {
        if (await hasActiveZipExport()) throw new DomainError({ code: 'ZIP_ACTIVE_DOWNLOAD' });
        const state = await startDownloads(message.candidateIds);
        return { ok: true, type: 'DOWNLOADS_STARTED', state };
      }
      case 'GET_DOWNLOAD_STATUS': {
        const state = await getDownloadState();
        return { ok: true, type: 'DOWNLOAD_STATUS', state };
      }
      case 'START_ZIP_EXPORT': {
        if (await hasActiveDownloads()) {
          throw new DomainError({ code: 'DOWNLOADS_ACTIVE_ZIP' });
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
      case 'GET_DISCORD_LAUNCHER_SETTING': {
        const enabled = await hasDiscordLauncherPermission();
        return { ok: true, type: 'DISCORD_LAUNCHER_SETTING', enabled };
      }
      case 'SYNC_DISCORD_LAUNCHER_SETTING': {
        const enabled = await reconcileDiscordLauncherRegistration();
        return { ok: true, type: 'DISCORD_LAUNCHER_SETTING', enabled };
      }
      case 'DISABLE_DISCORD_LAUNCHER_SETTING': {
        const enabled = await disableDiscordLauncher();
        return { ok: true, type: 'DISCORD_LAUNCHER_SETTING', enabled };
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: userFacingError(error),
    };
  }
}
