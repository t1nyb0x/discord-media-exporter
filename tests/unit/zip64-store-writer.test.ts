import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
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
});

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}
