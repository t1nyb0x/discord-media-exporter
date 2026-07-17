import { sanitizeFilename } from './filename';
import type { MediaCandidate, ZipExportState, ZipExportStatus } from './media';
import { DomainError } from './errors';

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
  | 'DOWNLOAD_NO_SPACE'
  | 'CONTEXT_LOST';

/** Converts selected candidates into ordered, uniquely named ZIP entries. */
export function prepareZipEntries(candidates: MediaCandidate[]): ZipEntryCandidate[] {
  if (candidates.length === 0) throw new DomainError({ code: 'ZIP_SELECTION_REQUIRED' });

  const usedNames = new Set<string>();
  const sequenceWidth = Math.max(3, String(candidates.length).length);
  return candidates.map((candidate, index) => ({
    candidateId: candidate.id,
    sourceUrl: candidate.sourceUrl,
    filename: uniqueFilename(
      `${String(index + 1).padStart(sequenceWidth, '0')}_${candidate.suggestedFilename}`,
      usedNames,
    ),
  }));
}

/** Creates the initial persisted ZIP export state. */
export function createIdleZipState(): ZipExportState {
  return {
    status: 'idle',
    totalItems: 0,
    completedItems: 0,
    processedBytes: 0,
    outputBytes: 0,
  };
}

/** Reports whether a ZIP export status represents unfinished work. */
export function isActiveZipStatus(status: ZipExportStatus): boolean {
  return status === 'fetching' || status === 'packing' || status === 'saving';
}

/** Creates a timestamped archive filename using the local clock. */
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

/** Reserves a case-insensitively unique, sanitized ZIP entry filename. */
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

  throw new DomainError({ code: 'ZIP_FILENAME_CONFLICT' });
}

/** Separates a short filename extension from its basename. */
function splitExtension(filename: string): { basename: string; extension: string } {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || filename.length - dotIndex > 16) {
    return { basename: filename, extension: '' };
  }
  return { basename: filename.slice(0, dotIndex), extension: filename.slice(dotIndex) };
}

/** Formats a date component as two decimal digits. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}
