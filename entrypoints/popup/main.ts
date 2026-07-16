import { browser } from 'wxt/browser';
import './style.css';
import type {
  CandidateCollection,
  DownloadBatchState,
  MediaCandidate,
  MediaKind,
  ScanResult,
  ZipExportState,
} from '../../src/domain/media';
import { MAX_COLLECTED_CANDIDATES } from '../../src/domain/download-manager';
import { discordChannelScope } from '../../src/domain/url';
import { isValidMediaCandidate } from '../../src/domain/validation';
import { isRecord, type ExtensionRequest, type ExtensionResponse } from '../../src/shared/messages';
import { ZIP_HOST_ORIGINS } from '../../src/shared/permissions';

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
void refreshDownloadStatus();
void refreshZipExportStatus();
const statusTimer = window.setInterval(() => {
  void refreshDownloadStatus();
  void refreshZipExportStatus();
}, 1_000);
window.addEventListener('unload', () => window.clearInterval(statusTimer));

async function toggleMediaCollector(): Promise<void> {
  await collectorStatusRestoration;
  if (state.collectorActive) await stopMediaCollector();
  else await startMediaCollector();
}

async function startMediaCollector(): Promise<void> {
  setBusy(scanButton, true, '開始中…');
  setNotice('');
  let targetTabId: number | undefined;

  try {
    await scanCollectionRestoration;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('対象タブを確認できませんでした。');
    targetTabId = tab.id;

    const injectionResults = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['scan.js'],
    });
    const scanResult = injectionResults[0]?.result;
    if (!isScanResult(scanResult)) throw new Error('スキャン結果を検証できませんでした。');
    if (!scanResult.ok) throw new Error(scanResult.message);

    const response = await sendRequest({
      type: 'REGISTER_SCAN_RESULT',
      scope: scanResult.scope,
      candidates: scanResult.candidates,
    });
    if (!response.ok) throw new Error(response.error);
    if (response.type !== 'SCAN_REGISTERED') throw new Error('予期しない応答です。');

    const previousIds = new Set(state.candidates.map((candidate) => candidate.id));
    const addedCount = response.collection.candidates.filter(
      (candidate) => !previousIds.has(candidate.id),
    ).length;
    applyCollection(response.collection);
    await browser.tabs
      .sendMessage(tab.id, {
        type: 'SET_MEDIA_COLLECTOR_COUNT',
        count: response.collection.candidates.length,
      })
      .catch(() => null);
    state.collectorActive = true;
    results.hidden = false;
    setNotice(
      state.candidates.length >= MAX_COLLECTED_CANDIDATES && addedCount === 0
        ? `自動収集を開始しました。収集上限の${MAX_COLLECTED_CANDIDATES}件に達しています。`
        : scanResult.candidates.length === 0
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

async function restoreCollectorStatus(): Promise<void> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    const response: unknown = await browser.tabs.sendMessage(tab.id, {
      type: 'GET_MEDIA_COLLECTOR_STATUS',
    });
    state.collectorActive =
      isRecord(response) && response.active === true && (await getActiveChannelScope()) !== null;
  } catch {
    state.collectorActive = false;
  } finally {
    scanButton.textContent = collectorButtonLabel();
  }
}

function collectorButtonLabel(): string {
  return state.collectorActive ? '自動収集を停止' : '自動収集を開始';
}

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

async function getActiveChannelScope(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.url === 'string' ? discordChannelScope(tab.url) : null;
}

function applyCollection(collection: CandidateCollection): void {
  state.candidates = collection.candidates;
  const candidateIds = new Set(collection.candidates.map((candidate) => candidate.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => candidateIds.has(id)));
  renderCandidates();
}

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

async function refreshZipExportStatus(): Promise<void> {
  try {
    const response = await sendRequest({ type: 'GET_EXPORT_STATUS' });
    if (!response.ok || response.type !== 'ZIP_EXPORT_STATUS') return;
    renderZipProgress(response.state);
  } catch {
    // The popup may be closing or the service worker may be restarting.
  }
}

function renderCandidates(): void {
  candidateList.replaceChildren();
  const candidates = filteredCandidates();

  for (const candidate of candidates) {
    const item = document.createElement('li');
    item.className = 'candidate';

    const label = document.createElement('label');
    label.className = 'candidate-label';

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

    const text = document.createElement('span');
    text.className = 'candidate-text';
    const name = document.createElement('span');
    name.className = 'candidate-name';
    name.textContent = candidate.displayName;
    const kind = document.createElement('span');
    kind.className = 'candidate-kind';
    kind.textContent = mediaKindLabel(candidate.kind);
    text.append(name, kind);

    label.append(checkbox, icon, text);
    item.append(label);
    candidateList.append(item);
  }

  candidateCount.textContent = `${state.candidates.length}件`;
  updateSelectionSummary();
}

function updateSelectionSummary(): void {
  const count = state.selectedIds.size;
  selectionSummary.textContent = `${count}件を選択中`;
  downloadButton.disabled = count === 0 || state.zipActive;
  zipButton.disabled = count === 0 || state.zipActive;
}

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
    const item = document.createElement('li');
    item.className = `progress-item progress-item-${downloadItem.status}`;

    const status = document.createElement('span');
    status.className = 'progress-status';
    status.textContent = downloadStatusLabel(downloadItem.status);

    const details = document.createElement('span');
    details.className = 'progress-details';
    const filename = document.createElement('span');
    filename.className = 'progress-filename';
    filename.textContent = downloadItem.filename;
    details.append(filename);

    if (downloadItem.error !== undefined) {
      const error = document.createElement('span');
      error.className = 'progress-error';
      error.textContent = downloadItem.error;
      details.append(error);
    }

    item.append(status, details);
    progressList.append(item);
  }
}

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

function filteredCandidates(): MediaCandidate[] {
  return state.filter === 'all'
    ? state.candidates
    : state.candidates.filter((candidate) => candidate.kind === state.filter);
}

async function sendRequest(request: ExtensionRequest): Promise<ExtensionResponse> {
  const response: unknown = await browser.runtime.sendMessage(request);
  if (!isExtensionResponse(response)) throw new Error('拡張機能からの応答を検証できませんでした。');
  return response;
}

function isScanResult(value: unknown): value is ScanResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) {
    return (
      typeof value.scope === 'string' &&
      discordChannelScope(value.scope) === value.scope &&
      Array.isArray(value.candidates) &&
      value.candidates.every(isValidMediaCandidate)
    );
  }
  return typeof value.code === 'string' && typeof value.message === 'string';
}

function isExtensionResponse(value: unknown): value is ExtensionResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (!value.ok) return typeof value.error === 'string';
  if (typeof value.type !== 'string') return false;
  if (['SCAN_REGISTERED', 'SCAN_COLLECTION', 'SCAN_COLLECTION_CLEARED'].includes(value.type)) {
    return isCandidateCollection(value.collection);
  }
  return true;
}

function isCandidateCollection(value: unknown): value is CandidateCollection {
  return (
    isRecord(value) &&
    (value.scope === null || typeof value.scope === 'string') &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isValidMediaCandidate)
  );
}

function isMediaFilter(value: string): value is MediaKind | 'all' {
  return ['all', 'image', 'video', 'file'].includes(value);
}

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function setNotice(message: string, isError = false): void {
  notice.textContent = message;
  notice.classList.toggle('notice-error', isError);
}

function setBusy(button: HTMLButtonElement, busy: boolean, label: string): void {
  button.disabled = busy;
  button.textContent = label;
  button.setAttribute('aria-busy', String(busy));
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Required element not found: ${id}`);
  return element as T;
}
