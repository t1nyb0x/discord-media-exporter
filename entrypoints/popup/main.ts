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
import { isRecord, type ExtensionRequest, type ExtensionResponse } from '../../src/shared/messages';
import { DISCORD_PAGE_ORIGIN, ZIP_HOST_ORIGINS } from '../../src/shared/permissions';

const state: {
  candidates: MediaCandidate[];
  selectedIds: Set<string>;
  filter: MediaKind | 'all';
  zipActive: boolean;
  collectorActive: boolean;
} = {
  candidates: [],
  selectedIds: new Set(),
  filter: 'all',
  zipActive: false,
  collectorActive: false,
};

const scanButton = requireElement<HTMLButtonElement>('scan-button');
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

/** Enables or disables automatic inactive-launcher injection from an explicit setting action. */
async function toggleDiscordLauncherSetting(): Promise<void> {
  launcherSettingToggle.disabled = true;
  setLauncherSettingStatus('設定を更新中…');

  try {
    if (launcherSettingToggle.checked) {
      const granted = await browser.permissions.request({
        origins: [DISCORD_PAGE_ORIGIN],
      });
      if (!granted) {
        launcherSettingToggle.checked = false;
        setLauncherSettingStatus('Discordサイト権限が許可されなかったためOFFのままです。', true);
        return;
      }
      const response = await sendRequest({ type: 'SYNC_DISCORD_LAUNCHER_SETTING' });
      const enabled = launcherSettingEnabled(response);
      launcherSettingToggle.checked = enabled;
      setLauncherSettingStatus(
        enabled
          ? 'ON: Discordチャンネルを開くと開始ボタンを表示します。'
          : '権限状態を同期できなかったためOFFです。',
        !enabled,
      );
      return;
    }

    const response = await sendRequest({ type: 'DISABLE_DISCORD_LAUNCHER_SETTING' });
    launcherSettingToggle.checked = launcherSettingEnabled(response);
    setLauncherSettingStatus('OFF: popupを開いた時だけ開始ボタンを表示します。');
  } catch (error) {
    await restoreDiscordLauncherSetting();
    setLauncherSettingStatus(
      error instanceof Error ? error.message : '常時表示の設定を更新できませんでした。',
      true,
    );
  } finally {
    launcherSettingToggle.disabled = false;
  }
}

/** Restores the launcher setting from the optional Discord permission state. */
async function restoreDiscordLauncherSetting(): Promise<void> {
  launcherSettingToggle.disabled = true;
  try {
    const response = await sendRequest({ type: 'GET_DISCORD_LAUNCHER_SETTING' });
    const enabled = launcherSettingEnabled(response);
    launcherSettingToggle.checked = enabled;
    setLauncherSettingStatus(
      enabled
        ? 'ON: Discordチャンネルを開くと開始ボタンを表示します。'
        : 'OFF: popupを開いた時だけ開始ボタンを表示します。',
    );
  } catch {
    launcherSettingToggle.checked = false;
    setLauncherSettingStatus('Discordサイト権限の状態を確認できませんでした。', true);
  } finally {
    launcherSettingToggle.disabled = false;
  }
}

/** Extracts a validated launcher-setting state from a background response. */
function launcherSettingEnabled(response: ExtensionResponse): boolean {
  if (!response.ok) throw new Error(response.error);
  if (response.type !== 'DISCORD_LAUNCHER_SETTING') {
    throw new Error('常時表示の設定状態を確認できませんでした。');
  }
  return response.enabled;
}

/** Updates the permission-setting status with an optional error style. */
function setLauncherSettingStatus(message: string, isError = false): void {
  launcherSettingStatus.textContent = message;
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
  setBusy(scanButton, true, '開始中…');
  setNotice('');
  let targetTabId: number | undefined;

  try {
    await scanCollectionRestoration;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('対象タブを確認できませんでした。');
    targetTabId = tab.id;
    const activeScope = typeof tab.url === 'string' ? discordChannelScope(tab.url) : null;
    if (activeScope === null) {
      throw new Error('Discordのチャンネル画面を開いてください。');
    }

    await ensurePageLauncher(tab.id);
    const collectorResponse = await sendCollectorRequest(tab.id, {
      type: 'START_MEDIA_COLLECTOR',
    });
    if (collectorResponse.type === 'MEDIA_COLLECTOR_START_FAILED') {
      throw new Error(collectorResponse.error);
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
        throw new Error('自動収集の候補を確認できませんでした。');
      }
      collection = collectionResponse.collection;
      visibleCandidateCount = 0;
    } else {
      throw new Error('自動収集の開始状態を確認できませんでした。');
    }
    if (collection.scope !== activeScope) throw new Error('自動収集の対象を確認できませんでした。');

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
        ? `自動収集を開始しました。収集上限の${MAX_COLLECTED_CANDIDATES}件に達しています。`
        : visibleCandidateCount === 0
          ? `自動収集を開始しました。Discord画面右下の「1画面戻る」も利用できます。現在の表示範囲に添付はありません（収集中 ${state.candidates.length}件）。`
          : `${addedCount}件を追加し、自動収集を開始しました。Discord画面右下の「1画面戻る」も利用できます（収集中 ${state.candidates.length}件）。`,
    );
  } catch (error) {
    if (targetTabId !== undefined) {
      await browser.tabs
        .sendMessage(targetTabId, { type: 'STOP_MEDIA_COLLECTOR' })
        .catch(() => null);
    }
    state.collectorActive = false;
    results.hidden = state.candidates.length === 0;
    setNotice(
      error instanceof Error ? error.message : '表示中メディアの確認に失敗しました。',
      true,
    );
  } finally {
    setBusy(scanButton, false, collectorButtonLabel());
  }
}

/** Stops collection in the active tab while preserving collected candidates. */
async function stopMediaCollector(): Promise<void> {
  setBusy(scanButton, true, '停止中…');
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await browser.tabs.sendMessage(tab.id, { type: 'STOP_MEDIA_COLLECTOR' }).catch(() => null);
    }
    state.collectorActive = false;
    setNotice(`自動収集を停止しました（収集中 ${state.candidates.length}件）。`);
  } finally {
    setBusy(scanButton, false, collectorButtonLabel());
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
    throw new Error('自動収集の状態を検証できませんでした。');
  }
  return response;
}

/** Returns the scan button label for the current collector state. */
function collectorButtonLabel(): string {
  return state.collectorActive ? '自動収集を停止' : '自動収集を開始';
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
      setNotice(`${state.candidates.length}件の収集結果を復元しました。`);
    }
  } catch {
    // A fresh scan remains available if the session collection cannot be restored.
  }
}

/** Clears the active channel collection and synchronizes the page controls. */
async function clearScanCollection(): Promise<void> {
  setBusy(clearCollectionButton, true, 'クリア中…');
  try {
    await scanCollectionRestoration;
    const scope = await getActiveChannelScope();
    if (scope === null) throw new Error('Discordのチャンネル画面を開いてください。');
    const response = await sendRequest({ type: 'CLEAR_SCAN_COLLECTION', scope });
    if (!response.ok) throw new Error(response.error);
    if (response.type !== 'SCAN_COLLECTION_CLEARED') throw new Error('予期しない応答です。');
    applyCollection(response.collection);
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await browser.tabs
        .sendMessage(tab.id, { type: 'SET_MEDIA_COLLECTOR_COUNT', count: 0 })
        .catch(() => null);
    }
    results.hidden = true;
    setNotice('このチャンネルの収集結果をクリアしました。');
  } catch (error) {
    setNotice(error instanceof Error ? error.message : '収集結果をクリアできませんでした。', true);
  } finally {
    setBusy(clearCollectionButton, false, '収集をクリア');
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
  setBusy(downloadButton, true, '開始中…');
  setNotice('');

  try {
    const response = await sendRequest({
      type: 'START_DOWNLOADS',
      candidateIds: [...state.selectedIds],
    });
    if (!response.ok) throw new Error(response.error);
    if (response.type !== 'DOWNLOADS_STARTED') throw new Error('予期しない応答です。');
    renderProgress(response.state);
    progress.hidden = false;
  } catch (error) {
    setNotice(
      error instanceof Error ? error.message : 'ダウンロードを開始できませんでした。',
      true,
    );
  } finally {
    setBusy(downloadButton, false, '個別に保存');
    updateSelectionSummary();
  }
}

/** Requests optional CDN access and starts a ZIP export for the selection. */
async function startSelectedZipExport(): Promise<void> {
  if (state.selectedIds.size === 0) return;
  setBusy(zipButton, true, '容量を確認中…');
  setNotice('');

  let permissionGranted = false;
  try {
    const storageNotice = await storageAvailabilityNotice();
    if (storageNotice !== '') setNotice(storageNotice);
    setBusy(zipButton, true, '権限を確認中…');
    permissionGranted = await browser.permissions.request({ origins: [...ZIP_HOST_ORIGINS] });
    if (!permissionGranted) {
      throw new Error('ZIP保存に必要なDiscord CDNへのアクセスが許可されませんでした。');
    }

    setBusy(zipButton, true, '開始中…');
    const response = await sendRequest({
      type: 'START_ZIP_EXPORT',
      candidateIds: [...state.selectedIds],
    });
    if (!response.ok) throw new Error(response.error);
    if (response.type !== 'ZIP_EXPORT_STARTED') throw new Error('予期しない応答です。');
    renderZipProgress(response.state);
  } catch (error) {
    if (permissionGranted) {
      await browser.permissions.remove({ origins: [...ZIP_HOST_ORIGINS] }).catch(() => false);
    }
    setNotice(error instanceof Error ? error.message : 'ZIP出力を開始できませんでした。', true);
  } finally {
    setBusy(zipButton, false, 'ZIPにまとめて保存');
    updateSelectionSummary();
  }
}

/** Describes estimated temporary storage availability without exposing paths. */
async function storageAvailabilityNotice(): Promise<string> {
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') return '';
    const available = Math.max(0, estimate.quota - estimate.usage);
    return `選択した${state.selectedIds.size}件をZIPへ逐次書き込みます。一時領域の推定空き容量: ${formatBytes(available)}。`;
  } catch {
    return `選択した${state.selectedIds.size}件をZIPへ逐次書き込みます。必要容量は事前に確認できませんでした。`;
  }
}

/** Cancels the active ZIP export and renders its resulting state. */
async function cancelZipExport(): Promise<void> {
  setBusy(zipCancelButton, true, 'キャンセル中…');
  try {
    const response = await sendRequest({ type: 'CANCEL_ZIP_EXPORT' });
    if (!response.ok) throw new Error(response.error);
    if (response.type !== 'ZIP_EXPORT_CANCELLED') throw new Error('予期しない応答です。');
    renderZipProgress(response.state);
  } catch (error) {
    setNotice(
      error instanceof Error ? error.message : 'ZIP出力をキャンセルできませんでした。',
      true,
    );
  } finally {
    setBusy(zipCancelButton, false, 'ZIP出力をキャンセル');
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

  candidateCount.textContent = `${state.candidates.length}件`;
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
  selectionSummary.textContent = `${count}件を選択中`;
  downloadButton.disabled = count === 0 || state.zipActive;
  zipButton.disabled = count === 0 || state.zipActive;
}

/** Renders a complete individual-download batch snapshot. */
function renderProgress(downloadState: DownloadBatchState): void {
  const counts = { queued: 0, in_progress: 0, complete: 0, failed: 0 };
  for (const item of downloadState.items) counts[item.status] += 1;
  progressSummary.textContent = [
    `完了 ${counts.complete}`,
    `進行中 ${counts.in_progress}`,
    `待機 ${counts.queued}`,
    `失敗 ${counts.failed}`,
  ].join(' / ');

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
    error.textContent = downloadItem.error;
    details.append(error);
  }

  item.append(status, details);
  return item;
}

/** Renders ZIP progress and synchronizes action availability. */
function renderZipProgress(zipState: ZipExportState): void {
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
  zipProgressSummary.textContent = [
    zipStatusLabel(zipState.status),
    `${zipState.completedItems}/${zipState.totalItems}件`,
    `入力 ${formatBytes(zipState.processedBytes)}`,
    `ZIP ${formatBytes(zipState.outputBytes ?? 0)}`,
  ].join(' / ');
  zipProgressDetail.textContent =
    zipState.error ?? zipState.currentFilename ?? zipState.archiveFilename ?? '';
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

/** Validates the shared extension response envelope used by the popup. */
function isExtensionResponse(value: unknown): value is ExtensionResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (!value.ok) return typeof value.error === 'string';
  if (typeof value.type !== 'string') return false;
  if (['SCAN_REGISTERED', 'SCAN_COLLECTION', 'SCAN_COLLECTION_CLEARED'].includes(value.type)) {
    return isCandidateCollection(value.collection);
  }
  if (value.type === 'DISCORD_LAUNCHER_SETTING') return typeof value.enabled === 'boolean';
  return true;
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
    return value.active === false && typeof value.error === 'string';
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
      return '画像';
    case 'video':
      return '動画';
    case 'file':
      return 'その他';
  }
}

/** Returns the localized display label for an individual download status. */
function downloadStatusLabel(status: DownloadBatchState['items'][number]['status']): string {
  switch (status) {
    case 'queued':
      return '待機';
    case 'in_progress':
      return '保存中';
    case 'complete':
      return '完了';
    case 'failed':
      return '失敗';
  }
}

/** Returns the localized display label for a ZIP export status. */
function zipStatusLabel(status: ZipExportState['status']): string {
  switch (status) {
    case 'idle':
      return '未実行';
    case 'fetching':
      return '取得中';
    case 'packing':
      return 'ZIP作成中';
    case 'saving':
      return '保存中';
    case 'complete':
      return '完了';
    case 'failed':
      return '失敗';
    case 'cancelled':
      return 'キャンセル済み';
  }
}

/** Formats a byte count using compact binary units. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Updates the popup notice using text-only DOM APIs. */
function setNotice(message: string, isError = false): void {
  notice.textContent = message;
  notice.classList.toggle('notice-error', isError);
}

/** Updates a button's busy state and accessible label. */
function setBusy(button: HTMLButtonElement, busy: boolean, label: string): void {
  button.disabled = busy;
  button.textContent = label;
  button.setAttribute('aria-busy', String(busy));
}

/** Returns a required popup element or fails during initialization. */
function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Required element not found: ${id}`);
  return element as T;
}
