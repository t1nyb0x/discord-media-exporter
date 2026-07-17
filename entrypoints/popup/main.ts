import { browser } from 'wxt/browser';
import './style.css';
import type {
  CandidateCollection,
  DownloadBatchState,
  MediaCandidate,
  MediaKind,
  ZipExportState,
} from '../../src/domain/media';
import { MAX_COLLECTED_CANDIDATES } from '../../src/domain/download-manager';
import { discordChannelScope, discordImageThumbnailUrl } from '../../src/domain/url';
import { isValidMediaCandidate } from '../../src/domain/validation';
import type { CollectorResponse } from '../../src/shared/collector-messages';
import {
  isExtensionResponse,
  isRecord,
  type ExtensionRequest,
  type ExtensionResponse,
} from '../../src/shared/messages';
import { DISCORD_PAGE_ORIGIN, ZIP_HOST_ORIGINS } from '../../src/shared/permissions';
import { isUserFacingError, type UserFacingError } from '../../src/domain/errors';
import {
  createTranslator,
  isLocalePreference,
  type LocalePreference,
  type TranslationKey,
  type TranslationParams,
  type Translator,
} from '../../src/shared/i18n';
import {
  chromeUiLanguage,
  loadResolvedLocale,
  saveLocalePreference,
} from '../../src/platform/chrome/locale-setting';

type DisplayMessage =
  { key: TranslationKey; params?: TranslationParams } | { error: UserFacingError } | null;

class PopupError extends Error {
  constructor(readonly detail: UserFacingError) {
    super(detail.code);
  }
}

let translator: Translator = createTranslator('ja');

const state: {
  candidates: MediaCandidate[];
  selectedIds: Set<string>;
  filter: MediaKind | 'all';
  zipActive: boolean;
  collectorActive: boolean;
  notice: DisplayMessage;
  noticeIsError: boolean;
  launcherMessage: DisplayMessage;
  launcherIsError: boolean;
  downloadState: DownloadBatchState | null;
  zipState: ZipExportState | null;
} = {
  candidates: [],
  selectedIds: new Set(),
  filter: 'all',
  zipActive: false,
  collectorActive: false,
  notice: null,
  noticeIsError: false,
  launcherMessage: { key: 'launcher_checking' },
  launcherIsError: false,
  downloadState: null,
  zipState: null,
};

const scanButton = requireElement<HTMLButtonElement>('scan-button');
const languageSelect = requireElement<HTMLSelectElement>('language-select');
const launcherSettingToggle = requireElement<HTMLInputElement>('launcher-setting-toggle');
const launcherSettingStatus = requireElement<HTMLElement>('launcher-setting-status');
const results = requireElement<HTMLElement>('results');
const candidateList = requireElement<HTMLUListElement>('candidate-list');
const candidateCount = requireElement<HTMLElement>('candidate-count');
const kindFilter = requireElement<HTMLSelectElement>('kind-filter');
const selectAllButton = requireElement<HTMLButtonElement>('select-all-button');
const clearButton = requireElement<HTMLButtonElement>('clear-button');
const clearCollectionButton = requireElement<HTMLButtonElement>('clear-collection-button');
const downloadButton = requireElement<HTMLButtonElement>('download-button');
const zipButton = requireElement<HTMLButtonElement>('zip-button');
const selectionSummary = requireElement<HTMLElement>('selection-summary');
const notice = requireElement<HTMLElement>('notice');
const progress = requireElement<HTMLElement>('progress');
const progressSummary = requireElement<HTMLElement>('progress-summary');
const progressList = requireElement<HTMLUListElement>('progress-list');
const zipProgress = requireElement<HTMLElement>('zip-progress');
const zipProgressSummary = requireElement<HTMLElement>('zip-progress-summary');
const zipProgressDetail = requireElement<HTMLElement>('zip-progress-detail');
const zipCancelButton = requireElement<HTMLButtonElement>('zip-cancel-button');

scanButton.addEventListener('click', () => void toggleMediaCollector());
launcherSettingToggle.addEventListener('change', () => void toggleDiscordLauncherSetting());
kindFilter.addEventListener('change', () => {
  state.filter = isMediaFilter(kindFilter.value) ? kindFilter.value : 'all';
  renderCandidates();
});
selectAllButton.addEventListener('click', () => {
  for (const candidate of filteredCandidates()) state.selectedIds.add(candidate.id);
  renderCandidates();
});
clearButton.addEventListener('click', () => {
  state.selectedIds.clear();
  renderCandidates();
});
clearCollectionButton.addEventListener('click', () => void clearScanCollection());
downloadButton.addEventListener('click', () => void startSelectedDownloads());
zipButton.addEventListener('click', () => void startSelectedZipExport());
zipCancelButton.addEventListener('click', () => void cancelZipExport());
languageSelect.addEventListener('change', () => void changeLanguage());

renderLocalizedState();
void restoreLocale();

const scanCollectionRestoration = restoreScanCollection();
void scanCollectionRestoration;
const collectorStatusRestoration = restoreCollectorStatus();
void collectorStatusRestoration;
void restoreDiscordLauncherSetting();
void refreshDownloadStatus();
void refreshZipExportStatus();
const statusTimer = window.setInterval(() => {
  void refreshDownloadStatus();
  void refreshZipExportStatus();
}, 1_000);
window.addEventListener('unload', () => window.clearInterval(statusTimer));

async function restoreLocale(): Promise<void> {
  const resolved = await loadResolvedLocale();
  languageSelect.value = resolved.preference;
  translator = createTranslator(resolved.locale);
  renderLocalizedState();
}

async function changeLanguage(): Promise<void> {
  const preference: LocalePreference = isLocalePreference(languageSelect.value)
    ? languageSelect.value
    : 'auto';
  await saveLocalePreference(preference);
  translator = createTranslator(
    preference === 'auto'
      ? chromeUiLanguage().toLowerCase().startsWith('ja')
        ? 'ja'
        : 'en'
      : preference,
  );
  renderLocalizedState();
}

/** Re-renders all static and state-derived text after a locale change. */
function renderLocalizedState(): void {
  document.documentElement.lang = translator.locale;
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n as TranslationKey;
    element.textContent = translator.t(key);
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    const key = element.dataset.i18nAriaLabel as TranslationKey;
    element.setAttribute('aria-label', translator.t(key));
  }
  renderButton(selectAllButton, 'select_visible');
  renderButton(clearButton, 'clear_selection');
  renderButton(clearCollectionButton, 'clear_collection');
  renderButton(downloadButton, 'individual_save');
  renderButton(zipButton, 'zip_save');
  renderButton(zipCancelButton, 'zip_cancel');
  candidateList.setAttribute('aria-label', translator.t('candidate_list_aria'));
  progressList.setAttribute('aria-label', translator.t('progress_list_aria'));
  renderButton(scanButton, state.collectorActive ? 'collector_stop' : 'collector_start');
  renderCandidates();
  renderDisplayMessage(launcherSettingStatus, state.launcherMessage);
  launcherSettingStatus.classList.toggle('launcher-setting-status-error', state.launcherIsError);
  renderDisplayMessage(notice, state.notice);
  notice.classList.toggle('notice-error', state.noticeIsError);
  if (state.downloadState !== null) renderProgress(state.downloadState);
  if (state.zipState !== null) renderZipProgress(state.zipState);
}

/** Enables or disables automatic inactive-launcher injection from an explicit setting action. */
async function toggleDiscordLauncherSetting(): Promise<void> {
  launcherSettingToggle.disabled = true;
  setLauncherSettingStatus({ key: 'launcher_updating' });

  try {
    if (launcherSettingToggle.checked) {
      const granted = await browser.permissions.request({
        origins: [DISCORD_PAGE_ORIGIN],
      });
      if (!granted) {
        launcherSettingToggle.checked = false;
        setLauncherSettingStatus({ key: 'launcher_denied' }, true);
        return;
      }
      const response = await sendRequest({ type: 'SYNC_DISCORD_LAUNCHER_SETTING' });
      const enabled = launcherSettingEnabled(response);
      launcherSettingToggle.checked = enabled;
      if (enabled) await showLauncherInActiveDiscordTab();
      setLauncherSettingStatus({ key: enabled ? 'launcher_on' : 'launcher_sync_failed' }, !enabled);
      return;
    }

    const response = await sendRequest({ type: 'DISABLE_DISCORD_LAUNCHER_SETTING' });
    launcherSettingToggle.checked = launcherSettingEnabled(response);
    setLauncherSettingStatus({ key: 'launcher_off' });
  } catch (error) {
    await restoreDiscordLauncherSetting();
    setLauncherSettingStatus(messageFromError(error, 'launcher_update_failed'), true);
  } finally {
    launcherSettingToggle.disabled = false;
  }
}

/** Immediately restores the launcher in the active Discord tab after the setting is enabled. */
async function showLauncherInActiveDiscordTab(): Promise<boolean> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (
    tab?.id === undefined ||
    typeof tab.url !== 'string' ||
    discordChannelScope(tab.url) === null
  ) {
    return false;
  }
  await ensurePageLauncher(tab.id);
  return true;
}

/** Restores the launcher setting from the optional Discord permission state. */
async function restoreDiscordLauncherSetting(): Promise<void> {
  launcherSettingToggle.disabled = true;
  try {
    const response = await sendRequest({ type: 'GET_DISCORD_LAUNCHER_SETTING' });
    const enabled = launcherSettingEnabled(response);
    launcherSettingToggle.checked = enabled;
    setLauncherSettingStatus({ key: enabled ? 'launcher_on' : 'launcher_off' });
  } catch {
    launcherSettingToggle.checked = false;
    setLauncherSettingStatus({ key: 'launcher_status_failed' }, true);
  } finally {
    launcherSettingToggle.disabled = false;
  }
}

/** Extracts a validated launcher-setting state from a background response. */
function launcherSettingEnabled(response: ExtensionResponse): boolean {
  if (!response.ok) throw new PopupError(response.error);
  if (response.type !== 'DISCORD_LAUNCHER_SETTING') {
    throw new PopupError({ code: 'RESPONSE_INVALID' });
  }
  return response.enabled;
}

/** Updates the permission-setting status with an optional error style. */
function setLauncherSettingStatus(message: DisplayMessage, isError = false): void {
  state.launcherMessage = message;
  state.launcherIsError = isError;
  renderDisplayMessage(launcherSettingStatus, message);
  launcherSettingStatus.classList.toggle('launcher-setting-status-error', isError);
}

/** Starts or stops collection based on the restored collector state. */
async function toggleMediaCollector(): Promise<void> {
  await collectorStatusRestoration;
  if (state.collectorActive) await stopMediaCollector();
  else await startMediaCollector();
}

/** Starts the injected page collector and updates popup state. */
async function startMediaCollector(): Promise<void> {
  setBusy(scanButton, true, 'collector_starting');
  setNotice(null);
  let targetTabId: number | undefined;

  try {
    await scanCollectionRestoration;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new PopupError({ code: 'UNEXPECTED_RESPONSE' });
    targetTabId = tab.id;
    const activeScope = typeof tab.url === 'string' ? discordChannelScope(tab.url) : null;
    if (activeScope === null) {
      throw new PopupError({ code: 'NOT_DISCORD_CHANNEL' });
    }

    await ensurePageLauncher(tab.id);
    const collectorResponse = await sendCollectorRequest(tab.id, {
      type: 'START_MEDIA_COLLECTOR',
    });
    if (collectorResponse.type === 'MEDIA_COLLECTOR_START_FAILED') {
      throw new PopupError(collectorResponse.error);
    }
    let collection: CandidateCollection;
    let visibleCandidateCount: number;
    if (collectorResponse.type === 'MEDIA_COLLECTOR_STARTED') {
      collection = collectorResponse.collection;
      visibleCandidateCount = collectorResponse.visibleCandidateCount;
    } else if (collectorResponse.active) {
      const collectionResponse = await sendRequest({
        type: 'GET_SCAN_COLLECTION',
        scope: activeScope,
      });
      if (!collectionResponse.ok || collectionResponse.type !== 'SCAN_COLLECTION') {
        throw new PopupError({ code: 'RESPONSE_INVALID' });
      }
      collection = collectionResponse.collection;
      visibleCandidateCount = 0;
    } else {
      throw new PopupError({ code: 'COLLECTOR_START_FAILED' });
    }
    if (collection.scope !== activeScope) throw new PopupError({ code: 'INVALID_SCAN_SCOPE' });

    const previousIds = new Set(state.candidates.map((candidate) => candidate.id));
    const addedCount = collection.candidates.filter(
      (candidate) => !previousIds.has(candidate.id),
    ).length;
    applyCollection(collection);
    await browser.tabs
      .sendMessage(tab.id, {
        type: 'SET_MEDIA_COLLECTOR_COUNT',
        count: collection.candidates.length,
      })
      .catch(() => null);
    state.collectorActive = true;
    results.hidden = false;
    setNotice(
      state.candidates.length >= MAX_COLLECTED_CANDIDATES && addedCount === 0
        ? { key: 'collector_started_limit', params: { limit: MAX_COLLECTED_CANDIDATES } }
        : visibleCandidateCount === 0
          ? { key: 'collector_started_empty', params: { count: state.candidates.length } }
          : {
              key: 'collector_started_added',
              params: { added: addedCount, count: state.candidates.length },
            },
    );
  } catch (error) {
    if (targetTabId !== undefined) {
      await browser.tabs
        .sendMessage(targetTabId, { type: 'STOP_MEDIA_COLLECTOR' })
        .catch(() => null);
    }
    state.collectorActive = false;
    results.hidden = state.candidates.length === 0;
    setNotice(messageFromError(error, 'error_SCAN_FAILED'), true);
  } finally {
    setBusy(scanButton, false, state.collectorActive ? 'collector_stop' : 'collector_start');
  }
}

/** Stops collection in the active tab while preserving collected candidates. */
async function stopMediaCollector(): Promise<void> {
  setBusy(scanButton, true, 'collector_stopping');
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await browser.tabs.sendMessage(tab.id, { type: 'STOP_MEDIA_COLLECTOR' }).catch(() => null);
    }
    state.collectorActive = false;
    setNotice({ key: 'collector_stopped', params: { count: state.candidates.length } });
  } finally {
    setBusy(scanButton, false, 'collector_start');
  }
}

/** Restores whether the active Discord tab still has a running collector. */
async function restoreCollectorStatus(): Promise<void> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (
      tab?.id === undefined ||
      typeof tab.url !== 'string' ||
      discordChannelScope(tab.url) === null
    ) {
      return;
    }
    await ensurePageLauncher(tab.id);
    const response = await sendCollectorRequest(tab.id, {
      type: 'GET_MEDIA_COLLECTOR_STATUS',
    });
    state.collectorActive =
      response.type === 'MEDIA_COLLECTOR_STATUS' &&
      response.active &&
      (await getActiveChannelScope()) !== null;
  } catch {
    state.collectorActive = false;
  } finally {
    scanButton.textContent = collectorButtonLabel();
  }
}

/** Injects or reuses the inactive page launcher after an explicit popup action. */
async function ensurePageLauncher(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['scan.js'],
  });
}

/** Sends and validates one popup-to-page collector request. */
async function sendCollectorRequest(
  tabId: number,
  request: { type: 'GET_MEDIA_COLLECTOR_STATUS' } | { type: 'START_MEDIA_COLLECTOR' },
): Promise<CollectorResponse> {
  const response: unknown = await browser.tabs.sendMessage(tabId, request);
  if (!isCollectorResponse(response)) {
    throw new PopupError({ code: 'RESPONSE_INVALID' });
  }
  return response;
}

/** Returns the scan button label for the current collector state. */
function collectorButtonLabel(): string {
  return translator.t(state.collectorActive ? 'collector_stop' : 'collector_start');
}

/** Restores the candidate collection for the active Discord channel. */
async function restoreScanCollection(): Promise<void> {
  try {
    const scope = await getActiveChannelScope();
    if (scope === null) return;
    const response = await sendRequest({ type: 'GET_SCAN_COLLECTION', scope });
    if (!response.ok || response.type !== 'SCAN_COLLECTION') return;
    applyCollection(response.collection);
    results.hidden = state.candidates.length === 0;
    if (state.candidates.length > 0) {
      setNotice({ key: 'restored_collection', params: { count: state.candidates.length } });
    }
  } catch {
    // A fresh scan remains available if the session collection cannot be restored.
  }
}

/** Clears the active channel collection and synchronizes the page controls. */
async function clearScanCollection(): Promise<void> {
  setBusy(clearCollectionButton, true, 'clearing');
  try {
    await scanCollectionRestoration;
    const scope = await getActiveChannelScope();
    if (scope === null) throw new PopupError({ code: 'NOT_DISCORD_CHANNEL' });
    const response = await sendRequest({ type: 'CLEAR_SCAN_COLLECTION', scope });
    if (!response.ok) throw new PopupError(response.error);
    if (response.type !== 'SCAN_COLLECTION_CLEARED')
      throw new PopupError({ code: 'UNEXPECTED_RESPONSE' });
    applyCollection(response.collection);
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await browser.tabs
        .sendMessage(tab.id, { type: 'SET_MEDIA_COLLECTOR_COUNT', count: 0 })
        .catch(() => null);
    }
    results.hidden = true;
    setNotice({ key: 'collection_cleared' });
  } catch (error) {
    setNotice(messageFromError(error, 'error_UNEXPECTED_RESPONSE'), true);
  } finally {
    setBusy(clearCollectionButton, false, 'clear_collection');
  }
}

/** Returns the validated Discord channel scope of the active tab. */
async function getActiveChannelScope(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.url === 'string' ? discordChannelScope(tab.url) : null;
}

/** Replaces popup candidates while retaining only still-valid selections. */
function applyCollection(collection: CandidateCollection): void {
  state.candidates = collection.candidates;
  const candidateIds = new Set(collection.candidates.map((candidate) => candidate.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => candidateIds.has(id)));
  renderCandidates();
}

/** Starts individual browser downloads for the selected candidates. */
async function startSelectedDownloads(): Promise<void> {
  if (state.selectedIds.size === 0) return;
  setBusy(downloadButton, true, 'starting');
  setNotice(null);

  try {
    const response = await sendRequest({
      type: 'START_DOWNLOADS',
      candidateIds: [...state.selectedIds],
    });
    if (!response.ok) throw new PopupError(response.error);
    if (response.type !== 'DOWNLOADS_STARTED')
      throw new PopupError({ code: 'UNEXPECTED_RESPONSE' });
    renderProgress(response.state);
    progress.hidden = false;
  } catch (error) {
    setNotice(messageFromError(error, 'error_DOWNLOAD_START_FAILED'), true);
  } finally {
    setBusy(downloadButton, false, 'individual_save');
    updateSelectionSummary();
  }
}

/** Requests optional CDN access and starts a ZIP export for the selection. */
async function startSelectedZipExport(): Promise<void> {
  if (state.selectedIds.size === 0) return;
  setBusy(zipButton, true, 'checking_space');
  setNotice(null);

  let permissionGranted = false;
  try {
    const storageNotice = await storageAvailabilityNotice();
    setNotice(storageNotice);
    setBusy(zipButton, true, 'checking_permission');
    permissionGranted = await browser.permissions.request({ origins: [...ZIP_HOST_ORIGINS] });
    if (!permissionGranted) {
      throw new PopupError({ code: 'CDN_PERMISSION_DENIED' });
    }

    setBusy(zipButton, true, 'starting');
    const response = await sendRequest({
      type: 'START_ZIP_EXPORT',
      candidateIds: [...state.selectedIds],
    });
    if (!response.ok) throw new PopupError(response.error);
    if (response.type !== 'ZIP_EXPORT_STARTED')
      throw new PopupError({ code: 'UNEXPECTED_RESPONSE' });
    renderZipProgress(response.state);
  } catch (error) {
    if (permissionGranted) {
      await browser.permissions.remove({ origins: [...ZIP_HOST_ORIGINS] }).catch(() => false);
    }
    setNotice(messageFromError(error, 'error_ZIP_FAILED'), true);
  } finally {
    setBusy(zipButton, false, 'zip_save');
    updateSelectionSummary();
  }
}

/** Describes estimated temporary storage availability without exposing paths. */
async function storageAvailabilityNotice(): Promise<DisplayMessage> {
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') return null;
    const available = Math.max(0, estimate.quota - estimate.usage);
    return { key: 'storage_available', params: { count: state.selectedIds.size, available } };
  } catch {
    return { key: 'storage_unknown', params: { count: state.selectedIds.size } };
  }
}

/** Cancels the active ZIP export and renders its resulting state. */
async function cancelZipExport(): Promise<void> {
  setBusy(zipCancelButton, true, 'cancelling');
  try {
    const response = await sendRequest({ type: 'CANCEL_ZIP_EXPORT' });
    if (!response.ok) throw new PopupError(response.error);
    if (response.type !== 'ZIP_EXPORT_CANCELLED')
      throw new PopupError({ code: 'UNEXPECTED_RESPONSE' });
    renderZipProgress(response.state);
  } catch (error) {
    setNotice(messageFromError(error, 'error_UNEXPECTED_RESPONSE'), true);
  } finally {
    setBusy(zipCancelButton, false, 'zip_cancel');
  }
}

/** Polls and renders individual download progress when available. */
async function refreshDownloadStatus(): Promise<void> {
  try {
    const response = await sendRequest({ type: 'GET_DOWNLOAD_STATUS' });
    if (!response.ok || response.type !== 'DOWNLOAD_STATUS') return;
    if (response.state.items.length === 0) return;
    progress.hidden = false;
    renderProgress(response.state);
  } catch {
    // The popup may be closing or the service worker may be restarting.
  }
}

/** Polls and renders ZIP export progress. */
async function refreshZipExportStatus(): Promise<void> {
  try {
    const response = await sendRequest({ type: 'GET_EXPORT_STATUS' });
    if (!response.ok || response.type !== 'ZIP_EXPORT_STATUS') return;
    renderZipProgress(response.state);
  } catch {
    // The popup may be closing or the service worker may be restarting.
  }
}

/** Renders the current filtered candidate collection. */
function renderCandidates(): void {
  candidateList.replaceChildren();
  const candidates = filteredCandidates();

  for (const candidate of candidates) {
    candidateList.append(createCandidateListItem(candidate));
  }

  candidateCount.textContent = translator.t('count', {
    count: translator.number(state.candidates.length),
  });
  updateSelectionSummary();
}

/** Creates one safely populated candidate selection row. */
function createCandidateListItem(candidate: MediaCandidate): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'candidate';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = state.selectedIds.has(candidate.id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selectedIds.add(candidate.id);
    else state.selectedIds.delete(candidate.id);
    updateSelectionSummary();
  });

  const icon = document.createElement('span');
  icon.className = `media-icon media-icon-${candidate.kind}`;
  icon.textContent = mediaKindLabel(candidate.kind).slice(0, 1);
  icon.setAttribute('aria-hidden', 'true');

  const preview = document.createElement('span');
  preview.className = 'candidate-preview';
  preview.append(icon);

  const thumbnailUrl = discordImageThumbnailUrl(candidate.sourceUrl);
  if (thumbnailUrl !== null) {
    const thumbnail = document.createElement('img');
    thumbnail.className = 'media-thumbnail media-thumbnail-loading';
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    thumbnail.decoding = 'async';
    thumbnail.draggable = false;
    thumbnail.referrerPolicy = 'no-referrer';
    thumbnail.width = 36;
    thumbnail.height = 36;
    thumbnail.addEventListener(
      'load',
      () => thumbnail.classList.remove('media-thumbnail-loading'),
      { once: true },
    );
    thumbnail.addEventListener('error', () => thumbnail.remove(), { once: true });
    thumbnail.src = thumbnailUrl;
    preview.append(thumbnail);
  }

  const name = document.createElement('span');
  name.className = 'candidate-name';
  name.textContent = candidate.displayName;
  const kind = document.createElement('span');
  kind.className = 'candidate-kind';
  kind.textContent = mediaKindLabel(candidate.kind);

  const text = document.createElement('span');
  text.className = 'candidate-text';
  text.append(name, kind);

  const label = document.createElement('label');
  label.className = 'candidate-label';
  label.append(checkbox, preview, text);
  item.append(label);
  return item;
}

/** Updates selection counts and action availability. */
function updateSelectionSummary(): void {
  const count = state.selectedIds.size;
  selectionSummary.textContent = translator.t('selected_count', {
    count: translator.number(count),
  });
  downloadButton.disabled = count === 0 || state.zipActive;
  zipButton.disabled = count === 0 || state.zipActive;
}

/** Renders a complete individual-download batch snapshot. */
function renderProgress(downloadState: DownloadBatchState): void {
  state.downloadState = downloadState;
  const counts = { queued: 0, in_progress: 0, complete: 0, failed: 0 };
  for (const item of downloadState.items) counts[item.status] += 1;
  progressSummary.textContent = translator.t('progress_summary', {
    complete: translator.number(counts.complete),
    inProgress: translator.number(counts.in_progress),
    queued: translator.number(counts.queued),
    failed: translator.number(counts.failed),
  });

  progressList.replaceChildren();
  for (const downloadItem of downloadState.items) {
    progressList.append(createProgressListItem(downloadItem));
  }
}

/** Creates one safely populated individual-download progress row. */
function createProgressListItem(downloadItem: DownloadBatchState['items'][number]): HTMLLIElement {
  const item = document.createElement('li');
  item.className = `progress-item progress-item-${downloadItem.status}`;

  const status = document.createElement('span');
  status.className = 'progress-status';
  status.textContent = downloadStatusLabel(downloadItem.status);

  const filename = document.createElement('span');
  filename.className = 'progress-filename';
  filename.textContent = downloadItem.filename;

  const details = document.createElement('span');
  details.className = 'progress-details';
  details.append(filename);

  if (downloadItem.error !== undefined) {
    const error = document.createElement('span');
    error.className = 'progress-error';
    error.textContent = translator.error(downloadItem.error);
    details.append(error);
  }

  item.append(status, details);
  return item;
}

/** Renders ZIP progress and synchronizes action availability. */
function renderZipProgress(zipState: ZipExportState): void {
  state.zipState = zipState;
  if (zipState.status === 'idle') {
    zipProgress.hidden = true;
    state.zipActive = false;
    updateSelectionSummary();
    return;
  }

  const active = ['fetching', 'packing', 'saving'].includes(zipState.status);
  state.zipActive = active;
  zipProgress.hidden = false;
  zipCancelButton.hidden = !active;
  zipProgressSummary.textContent = translator.t('zip_summary', {
    status: zipStatusLabel(zipState.status),
    completed: translator.number(zipState.completedItems),
    total: translator.number(zipState.totalItems),
    input: translator.bytes(zipState.processedBytes),
    output: translator.bytes(zipState.outputBytes ?? 0),
  });
  zipProgressDetail.textContent =
    (zipState.error === undefined ? undefined : translator.error(zipState.error)) ??
    zipState.currentFilename ??
    zipState.archiveFilename ??
    '';
  updateSelectionSummary();
}

/** Returns candidates matching the current media-kind filter. */
function filteredCandidates(): MediaCandidate[] {
  return state.filter === 'all'
    ? state.candidates
    : state.candidates.filter((candidate) => candidate.kind === state.filter);
}

/** Sends a typed request and validates the extension response envelope. */
async function sendRequest(request: ExtensionRequest): Promise<ExtensionResponse> {
  const response: unknown = await browser.runtime.sendMessage(request);
  if (!isExtensionResponse(response)) throw new Error('拡張機能からの応答を検証できませんでした。');
  return response;
}

/** Validates a candidate collection returned across an extension boundary. */
function isCandidateCollection(value: unknown): value is CandidateCollection {
  return (
    isRecord(value) &&
    (value.scope === null || typeof value.scope === 'string') &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isValidMediaCandidate)
  );
}

/** Validates a page collector response before updating popup state. */
function isCollectorResponse(value: unknown): value is CollectorResponse {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.active !== 'boolean') {
    return false;
  }
  if (value.type === 'MEDIA_COLLECTOR_STATUS') return true;
  if (value.type === 'MEDIA_COLLECTOR_START_FAILED') {
    return value.active === false && isUserFacingError(value.error);
  }
  return (
    value.type === 'MEDIA_COLLECTOR_STARTED' &&
    value.active === true &&
    isCandidateCollection(value.collection) &&
    typeof value.visibleCandidateCount === 'number' &&
    Number.isInteger(value.visibleCandidateCount) &&
    value.visibleCandidateCount >= 0 &&
    value.visibleCandidateCount <= MAX_COLLECTED_CANDIDATES
  );
}

/** Validates a media-kind filter value from the popup select element. */
function isMediaFilter(value: string): value is MediaKind | 'all' {
  return ['all', 'image', 'video', 'file'].includes(value);
}

/** Returns the localized display label for a media kind. */
function mediaKindLabel(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return translator.t('media_image');
    case 'video':
      return translator.t('media_video');
    case 'file':
      return translator.t('media_file');
  }
}

/** Returns the localized display label for an individual download status. */
function downloadStatusLabel(status: DownloadBatchState['items'][number]['status']): string {
  switch (status) {
    case 'queued':
      return translator.t('kind_queued');
    case 'in_progress':
      return translator.t('kind_in_progress');
    case 'complete':
      return translator.t('kind_complete');
    case 'failed':
      return translator.t('kind_failed');
  }
}

/** Returns the localized display label for a ZIP export status. */
function zipStatusLabel(status: ZipExportState['status']): string {
  switch (status) {
    case 'idle':
      return translator.t('zip_idle');
    case 'fetching':
      return translator.t('zip_fetching');
    case 'packing':
      return translator.t('zip_packing');
    case 'saving':
      return translator.t('zip_saving');
    case 'complete':
      return translator.t('zip_complete');
    case 'failed':
      return translator.t('zip_failed');
    case 'cancelled':
      return translator.t('zip_cancelled');
  }
}

/** Updates the popup notice using text-only DOM APIs. */
function setNotice(message: DisplayMessage, isError = false): void {
  state.notice = message;
  state.noticeIsError = isError;
  renderDisplayMessage(notice, message);
  notice.classList.toggle('notice-error', isError);
}

/** Updates a button's busy state and accessible label. */
function setBusy(button: HTMLButtonElement, busy: boolean, label: TranslationKey): void {
  button.disabled = busy;
  button.dataset.i18nButtonKey = label;
  button.textContent = translator.t(label);
  button.setAttribute('aria-busy', String(busy));
}

function renderDisplayMessage(element: HTMLElement, message: DisplayMessage): void {
  const params =
    message !== null && 'key' in message && message.key === 'storage_available'
      ? { ...message.params, bytes: translator.bytes(Number(message.params?.available ?? 0)) }
      : message !== null && 'key' in message
        ? message.params
        : undefined;
  element.textContent =
    message === null
      ? ''
      : 'error' in message
        ? translator.error(message.error)
        : translator.t(message.key, params);
}

function renderButton(button: HTMLButtonElement, fallback: TranslationKey): void {
  const key = (button.dataset.i18nButtonKey as TranslationKey | undefined) ?? fallback;
  button.textContent = translator.t(key);
}

function messageFromError(error: unknown, fallback: TranslationKey): DisplayMessage {
  if (error instanceof PopupError) return { error: error.detail };
  return { key: fallback };
}

/** Returns a required popup element or fails during initialization. */
function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Required element not found: ${id}`);
  return element as T;
}
