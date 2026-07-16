import { sanitizeFilename } from './filename';
import type { MediaCandidate, ZipExportState, ZipExportStatus } from './media';

export interface ZipEntryCandidate {
  candidateId: string;
  sourceUrl: string;
  filename: string;
}

export type ZipExportErrorCode =
  | 'FETCH_FAILED'
  | 'INVALID_REDIRECT'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'TEMP_WRITE_FAILED'
  | 'ZIP_FAILED'
  | 'SAVE_FAILED'
  | 'CONTEXT_LOST';

export function prepareZipEntries(candidates: MediaCandidate[]): ZipEntryCandidate[] {
  if (candidates.length === 0) throw new Error('ZIPに保存するメディアを選択してください。');

  const usedNames = new Set<string>();
  return candidates.map((candidate) => ({
    candidateId: candidate.id,
    sourceUrl: candidate.sourceUrl,
    filename: uniqueFilename(candidate.suggestedFilename, usedNames),
  }));
}

export function createIdleZipState(): ZipExportState {
  return {
    status: 'idle',
    totalItems: 0,
    completedItems: 0,
    processedBytes: 0,
    outputBytes: 0,
  };
}

export function isActiveZipStatus(status: ZipExportStatus): boolean {
  return status === 'fetching' || status === 'packing' || status === 'saving';
}

export function createZipArchiveFilename(date = new Date()): string {
  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ];
  return `discord-media-${parts.join('')}.zip`;
}

export function zipExportErrorMessage(code: ZipExportErrorCode, filename?: string): string {
  const target = filename === undefined ? '' : `「${sanitizeFilename(filename)}」を`;
  switch (code) {
    case 'FETCH_FAILED':
      return `${target}取得できませんでした。再スキャンしてから試してください。`;
    case 'INVALID_REDIRECT':
      return `${target}安全な取得先として確認できませんでした。`;
    case 'STORAGE_QUOTA_EXCEEDED':
      return 'ZIP一時ファイルを保存する空き容量が不足しています。';
    case 'TEMP_WRITE_FAILED':
      return 'ZIP一時ファイルへ書き込めませんでした。';
    case 'ZIP_FAILED':
      return 'ZIPを生成できませんでした。';
    case 'SAVE_FAILED':
      return '生成したZIPの保存を開始できませんでした。';
    case 'CONTEXT_LOST':
      return 'ZIP生成状態を復元できませんでした。もう一度実行してください。';
  }
}

function uniqueFilename(input: string, usedNames: Set<string>): string {
  const safeName = sanitizeFilename(input);
  if (!usedNames.has(safeName.toLocaleLowerCase())) {
    usedNames.add(safeName.toLocaleLowerCase());
    return safeName;
  }

  const { basename, extension } = splitExtension(safeName);
  for (let index = 2; index <= usedNames.size + 2; index += 1) {
    const suffix = ` (${index})`;
    const candidate = sanitizeFilename(
      `${basename.slice(0, Math.max(1, 180 - extension.length - suffix.length))}${suffix}${extension}`,
    );
    const key = candidate.toLocaleLowerCase();
    if (usedNames.has(key)) continue;
    usedNames.add(key);
    return candidate;
  }

  throw new Error('ZIP内のファイル名を一意にできませんでした。');
}

function splitExtension(filename: string): { basename: string; extension: string } {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || filename.length - dotIndex > 16) {
    return { basename: filename, extension: '' };
  }
  return { basename: filename.slice(0, dotIndex), extension: filename.slice(dotIndex) };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
