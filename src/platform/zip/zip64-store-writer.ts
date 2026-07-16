export interface ZipArchiveSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<Blob>;
  abort(): Promise<void>;
}

interface CentralDirectoryEntry {
  filename: Uint8Array;
  crc32: number;
  size: bigint;
  localHeaderOffset: bigint;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const ZIP_VERSION_45 = 45;
const UTF8_WITH_DATA_DESCRIPTOR_FLAGS = 0x0808;
const STORED_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

export class Zip64StoreWriter {
  private readonly entries: CentralDirectoryEntry[] = [];
  private offset = 0n;
  private activeEntry = false;
  private finished = false;

  constructor(private readonly sink: ZipArchiveSink) {}

  async startEntry(filename: string): Promise<Zip64EntryWriter> {
    if (this.finished) throw new Error('ZIP writer is already finished.');
    if (this.activeEntry) throw new Error('Finish the current ZIP entry before starting another.');

    const encodedFilename = new TextEncoder().encode(filename);
    if (encodedFilename.length === 0 || encodedFilename.length > UINT16_MAX) {
      throw new Error('ZIP entry filename is invalid.');
    }

    const localHeaderOffset = this.offset;
    await this.write(createLocalFileHeader(encodedFilename));
    this.activeEntry = true;

    return new Zip64EntryWriter(
      async (chunk) => this.write(chunk),
      async (crc32, size) => {
        await this.write(createZip64DataDescriptor(crc32, size));
        this.entries.push({ filename: encodedFilename, crc32, size, localHeaderOffset });
        this.activeEntry = false;
      },
    );
  }

  async finalize(): Promise<{ blob: Blob; outputBytes: bigint }> {
    if (this.finished) throw new Error('ZIP writer is already finished.');
    if (this.activeEntry) throw new Error('The current ZIP entry is not finished.');
    this.finished = true;

    const centralDirectoryOffset = this.offset;
    for (const entry of this.entries) {
      await this.write(createCentralDirectoryEntry(entry));
    }
    const centralDirectorySize = this.offset - centralDirectoryOffset;
    const zip64EndOffset = this.offset;
    await this.write(
      createZip64EndRecord(
        BigInt(this.entries.length),
        centralDirectorySize,
        centralDirectoryOffset,
      ),
    );
    await this.write(createZip64Locator(zip64EndOffset));
    await this.write(createEndOfCentralDirectory());

    const outputBytes = this.offset;
    const blob = await this.sink.close();
    return { blob, outputBytes };
  }

  async abort(): Promise<void> {
    this.finished = true;
    this.activeEntry = false;
    await this.sink.abort();
  }

  getOutputBytes(): bigint {
    return this.offset;
  }

  private async write(chunk: Uint8Array): Promise<void> {
    await this.sink.write(chunk);
    this.offset += BigInt(chunk.byteLength);
  }
}

export class Zip64EntryWriter {
  private crc = 0xffffffff;
  private size = 0n;
  private finished = false;

  constructor(
    private readonly writeChunk: (chunk: Uint8Array) => Promise<void>,
    private readonly finishEntry: (crc32: number, size: bigint) => Promise<void>,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.finished) throw new Error('ZIP entry is already finished.');
    if (chunk.byteLength === 0) return;
    this.crc = updateCrc32(this.crc, chunk);
    this.size += BigInt(chunk.byteLength);
    await this.writeChunk(chunk);
  }

  async close(): Promise<void> {
    if (this.finished) throw new Error('ZIP entry is already finished.');
    this.finished = true;
    await this.finishEntry((this.crc ^ 0xffffffff) >>> 0, this.size);
  }
}

export class MemoryZipArchiveSink implements ZipArchiveSink {
  private readonly chunks: ArrayBuffer[] = [];
  private aborted = false;

  async write(chunk: Uint8Array): Promise<void> {
    if (this.aborted) throw new Error('Archive sink was aborted.');
    this.chunks.push(Uint8Array.from(chunk).buffer);
  }

  async close(): Promise<Blob> {
    if (this.aborted) throw new Error('Archive sink was aborted.');
    return new Blob(this.chunks, { type: 'application/zip' });
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.chunks.length = 0;
  }
}

function createLocalFileHeader(filename: Uint8Array): Uint8Array {
  const extraLength = 20;
  const bytes = new Uint8Array(30 + filename.length + extraLength);
  const view = dataView(bytes);
  view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION_45, true);
  view.setUint16(6, UTF8_WITH_DATA_DESCRIPTOR_FLAGS, true);
  view.setUint16(8, STORED_METHOD, true);
  view.setUint16(10, DOS_TIME, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(18, UINT32_MAX, true);
  view.setUint32(22, UINT32_MAX, true);
  view.setUint16(26, filename.length, true);
  view.setUint16(28, extraLength, true);
  bytes.set(filename, 30);

  const extraOffset = 30 + filename.length;
  view.setUint16(extraOffset, ZIP64_EXTRA_FIELD_ID, true);
  view.setUint16(extraOffset + 2, 16, true);
  view.setBigUint64(extraOffset + 4, 0n, true);
  view.setBigUint64(extraOffset + 12, 0n, true);
  return bytes;
}

function createZip64DataDescriptor(crc32: number, size: bigint): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = dataView(bytes);
  view.setUint32(0, DATA_DESCRIPTOR_SIGNATURE, true);
  view.setUint32(4, crc32, true);
  view.setBigUint64(8, size, true);
  view.setBigUint64(16, size, true);
  return bytes;
}

function createCentralDirectoryEntry(entry: CentralDirectoryEntry): Uint8Array {
  const extraLength = 28;
  const bytes = new Uint8Array(46 + entry.filename.length + extraLength);
  const view = dataView(bytes);
  view.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION_45, true);
  view.setUint16(6, ZIP_VERSION_45, true);
  view.setUint16(8, UTF8_WITH_DATA_DESCRIPTOR_FLAGS, true);
  view.setUint16(10, STORED_METHOD, true);
  view.setUint16(12, DOS_TIME, true);
  view.setUint16(14, DOS_DATE, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, UINT32_MAX, true);
  view.setUint32(24, UINT32_MAX, true);
  view.setUint16(28, entry.filename.length, true);
  view.setUint16(30, extraLength, true);
  view.setUint32(42, UINT32_MAX, true);
  bytes.set(entry.filename, 46);

  const extraOffset = 46 + entry.filename.length;
  view.setUint16(extraOffset, ZIP64_EXTRA_FIELD_ID, true);
  view.setUint16(extraOffset + 2, 24, true);
  view.setBigUint64(extraOffset + 4, entry.size, true);
  view.setBigUint64(extraOffset + 12, entry.size, true);
  view.setBigUint64(extraOffset + 20, entry.localHeaderOffset, true);
  return bytes;
}

function createZip64EndRecord(
  entryCount: bigint,
  centralDirectorySize: bigint,
  centralDirectoryOffset: bigint,
): Uint8Array {
  const bytes = new Uint8Array(56);
  const view = dataView(bytes);
  view.setUint32(0, ZIP64_END_SIGNATURE, true);
  view.setBigUint64(4, 44n, true);
  view.setUint16(12, ZIP_VERSION_45, true);
  view.setUint16(14, ZIP_VERSION_45, true);
  view.setBigUint64(24, entryCount, true);
  view.setBigUint64(32, entryCount, true);
  view.setBigUint64(40, centralDirectorySize, true);
  view.setBigUint64(48, centralDirectoryOffset, true);
  return bytes;
}

function createZip64Locator(zip64EndOffset: bigint): Uint8Array {
  const bytes = new Uint8Array(20);
  const view = dataView(bytes);
  view.setUint32(0, ZIP64_LOCATOR_SIGNATURE, true);
  view.setBigUint64(8, zip64EndOffset, true);
  view.setUint32(16, 1, true);
  return bytes;
}

function createEndOfCentralDirectory(): Uint8Array {
  const bytes = new Uint8Array(22);
  const view = dataView(bytes);
  view.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(8, UINT16_MAX, true);
  view.setUint16(10, UINT16_MAX, true);
  view.setUint32(12, UINT32_MAX, true);
  view.setUint32(16, UINT32_MAX, true);
  return bytes;
}

function updateCrc32(current: number, bytes: Uint8Array): number {
  let crc = current;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return crc;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}
