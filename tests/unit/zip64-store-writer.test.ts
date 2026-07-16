import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  encodeZip64CentralDirectoryEntry,
  MemoryZipArchiveSink,
  Zip64StoreWriter,
  type ZipArchiveSink,
} from '../../src/platform/zip/zip64-store-writer';

describe('Zip64StoreWriter', () => {
  it('writes a valid ZIP64 archive with CRC and UTF-8 filenames', async () => {
    const writer = new Zip64StoreWriter(new MemoryZipArchiveSink());
    const first = await writer.startEntry('photo.png');
    await first.write(strToU8('image'));
    await first.close();
    const second = await writer.startEntry('メモ.txt');
    await second.write(strToU8('hello'));
    await second.close();

    const result = await writer.finalize();
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const archive = unzipSync(bytes);

    expect(strFromU8(archive['photo.png']!)).toBe('image');
    expect(strFromU8(archive['メモ.txt']!)).toBe('hello');
    expect(result.outputBytes).toBe(BigInt(bytes.byteLength));
    expect(findSignature(bytes, 0x06064b50)).toBeGreaterThan(0);
    expect(findSignature(bytes, 0x07064b50)).toBeGreaterThan(0);
    expect(findSignature(bytes, 0x06054b50)).toBeGreaterThan(0);

    const centralOffset = findSignature(bytes, 0x02014b50);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(centralOffset + 20, true)).toBe(0xffffffff);
    expect(view.getUint32(centralOffset + 24, true)).toBe(0xffffffff);
    expect(view.getUint32(centralOffset + 42, true)).toBe(0xffffffff);
    const filenameLength = view.getUint16(centralOffset + 28, true);
    const extraOffset = centralOffset + 46 + filenameLength;
    expect(view.getUint16(extraOffset, true)).toBe(0x0001);
    expect(view.getUint16(extraOffset + 2, true)).toBe(24);
    expect(view.getBigUint64(extraOffset + 4, true)).toBe(5n);
    expect(view.getBigUint64(extraOffset + 12, true)).toBe(5n);
  });

  it('applies sink backpressure before accepting the next operation', async () => {
    let releaseWrite: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let writes = 0;
    const sink: ZipArchiveSink = {
      async write() {
        writes += 1;
        if (writes === 1) await firstWrite;
      },
      async close() {
        return new Blob();
      },
      async abort() {},
    };
    const writer = new Zip64StoreWriter(sink);
    let entryStarted = false;
    const pendingEntry = writer.startEntry('file.bin').then((entry) => {
      entryStarted = true;
      return entry;
    });

    await Promise.resolve();
    expect(entryStarted).toBe(false);
    releaseWrite!();
    const entry = await pendingEntry;
    expect(entryStarted).toBe(true);
    await entry.close();
    await writer.finalize();
  });

  it.each([0xffffffffn, 0x100000000n])(
    'encodes the synthetic %s-byte entry size as a ZIP64 64-bit value',
    (size) => {
      const record = encodeZip64CentralDirectoryEntry({
        filename: strToU8('large.bin'),
        crc32: 0x12345678,
        size,
        localHeaderOffset: 0x100000000n,
      });
      const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
      const filenameLength = view.getUint16(28, true);
      const extraOffset = 46 + filenameLength;

      expect(view.getUint32(20, true)).toBe(0xffffffff);
      expect(view.getUint32(24, true)).toBe(0xffffffff);
      expect(view.getUint32(42, true)).toBe(0xffffffff);
      expect(view.getBigUint64(extraOffset + 4, true)).toBe(size);
      expect(view.getBigUint64(extraOffset + 12, true)).toBe(size);
      expect(view.getBigUint64(extraOffset + 20, true)).toBe(0x100000000n);
    },
  );

  it('keeps offsets above 4 GiB in ZIP64 central and locator records', async () => {
    const initialOffset = 0x100000000n;
    const writer = new Zip64StoreWriter(new MemoryZipArchiveSink(), { initialOffset });
    const entry = await writer.startEntry('offset.bin');
    await entry.close();
    const result = await writer.finalize();
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const centralOffset = findSignature(bytes, 0x02014b50);
    const filenameLength = view.getUint16(centralOffset + 28, true);
    const centralExtraOffset = centralOffset + 46 + filenameLength;
    const locatorOffset = findSignature(bytes, 0x07064b50);

    expect(view.getBigUint64(centralExtraOffset + 20, true)).toBe(initialOffset);
    expect(view.getBigUint64(locatorOffset + 8, true)).toBeGreaterThan(initialOffset);
    expect(result.outputBytes).toBeGreaterThan(initialOffset);
  });

  it.each([65535, 65536])(
    'records %i entries in the ZIP64 end record',
    async (entryCount) => {
      let zip64EndRecord: Uint8Array | undefined;
      const sink: ZipArchiveSink = {
        async write(chunk) {
          if (signature(chunk) === 0x06064b50) zip64EndRecord = Uint8Array.from(chunk);
        },
        async close() {
          return new Blob();
        },
        async abort() {},
      };
      const writer = new Zip64StoreWriter(sink);
      for (let index = 0; index < entryCount; index += 1) {
        const entry = await writer.startEntry('empty');
        await entry.close();
      }
      await writer.finalize();

      expect(zip64EndRecord).toBeDefined();
      const view = new DataView(zip64EndRecord!.buffer);
      expect(view.getBigUint64(24, true)).toBe(BigInt(entryCount));
      expect(view.getBigUint64(32, true)).toBe(BigInt(entryCount));
    },
    30_000,
  );
});

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

function signature(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < 4) return undefined;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
}
