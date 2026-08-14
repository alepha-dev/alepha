import { AlephaError } from "alepha";

/**
 * Largest value a ZIP header field can hold without ZIP64.
 */
const ZIP64_LIMIT = 0xffffffff;

/**
 * How an entry's bytes are stored in the archive.
 *
 * - `store` — no compression (ZIP method 0).
 * - `deflate` — raw DEFLATE (ZIP method 8).
 */
export type ZipEntryMethod = "store" | "deflate";

/**
 * One file in the archive.
 */
export interface ZipEntry {
  /**
   * Path inside the archive, `/`-separated (e.g. `assets/photo.webp`).
   */
  name: string;

  /**
   * The file's bytes, either whole or as a stream.
   *
   * Typed against `ArrayBuffer` rather than the wider `ArrayBufferLike`
   * because the bytes are handed to `CompressionStream`, whose `BufferSource`
   * input excludes `SharedArrayBuffer`-backed views.
   *
   * A stream is written without ever being held whole in memory, at the cost
   * of a trailing data descriptor per entry (see {@link ZipArchive}).
   */
  data: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array<ArrayBuffer>>;

  /**
   * Defaults to `deflate`.
   *
   * Choose `store` for bytes that are already compressed — WebP, JPEG, PNG,
   * most video. Deflating those gains a percent or two for real CPU, which on
   * a metered runtime is a cost with no benefit.
   */
  method?: ZipEntryMethod;

  /**
   * Modification time, interpreted in **UTC**.
   *
   * Defaults to 1980-01-01, the start of the DOS epoch ZIP timestamps are
   * expressed in. Taken as a parameter rather than read from the clock so
   * that identical input yields byte-identical output — and because the
   * repo's `DateTimeProvider` rule has no sensible seam inside a stream
   * primitive.
   *
   * UTC rather than local time (which is the older ZIP convention) so the
   * bytes do not change with the machine's timezone.
   */
  lastModified?: Date | number;
}

/**
 * What the writer must remember about an entry between emitting its local
 * header and, much later, its central directory record.
 */
interface ZipDirectoryRecord {
  name: Uint8Array;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  dosDate: number;
  dosTime: number;
}

/**
 * Builds ZIP archives as a stream, using only `ReadableStream`,
 * `TransformStream` and `CompressionStream` — so the same code runs on Node,
 * Bun, workerd and in the browser, with no dependency.
 *
 * @example
 * ```typescript
 * const zip = alepha.inject(ZipArchive);
 *
 * const stream = zip.create([
 *   { name: "notes.md", data: markdown },                    // deflated
 *   { name: "assets/photo.webp", data: bytes, method: "store" },
 * ]);
 *
 * // Browser: hand it to a download. Server: pipe it to the response.
 * const blob = await new Response(stream).blob();
 * ```
 *
 * ## Why a data descriptor
 *
 * A ZIP local header carries the CRC-32 and both sizes, but it is written
 * *before* the payload — which for a streamed entry is not yet known. The
 * format's answer is general-purpose bit 3: write zeros in the header, then
 * emit the real values in a 16-byte descriptor after the payload. Without it
 * every entry would have to be buffered whole first, which is the thing the
 * streaming design exists to avoid.
 *
 * Entries given as a `Uint8Array` skip the descriptor — their sizes are known
 * up front, so the header can be honest and the archive stays maximally
 * compatible.
 *
 * ## Limits
 *
 * No ZIP64: entries above 4 GB, archives above 4 GB, or more than 65535
 * entries are rejected rather than silently written as a corrupt archive.
 */
export class ZipArchive {
  /**
   * Lazily-built CRC-32 lookup table (polynomial 0xedb88320).
   *
   * Hand-written because `CompressionStream` exposes no checksum. Harvesting
   * one from a `"gzip"` trailer instead would bet on gzip header framing
   * being byte-identical across V8, JavaScriptCore and workerd — a runtime
   * coupling not worth the ten lines it would save.
   */
  protected static table: Uint32Array | undefined;

  /**
   * Builds the archive. The returned stream is consumed once.
   */
  public create(entries: Iterable<ZipEntry>): ReadableStream<Uint8Array> {
    const iterator = this.generate(entries);
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      },
      async cancel(reason) {
        await iterator.return?.(reason);
      },
    });
  }

  /**
   * Emits the archive in order: each entry's local header and payload, then
   * the central directory, then the end-of-central-directory record.
   */
  protected async *generate(
    entries: Iterable<ZipEntry>,
  ): AsyncGenerator<Uint8Array> {
    const directory: ZipDirectoryRecord[] = [];
    let offset = 0;

    for (const entry of entries) {
      const name = new TextEncoder().encode(entry.name);
      const method = entry.method === "store" ? 0 : 8;

      const stamp = this.dosStamp(entry.lastModified);

      if (entry.data instanceof ReadableStream) {
        yield* this.writeStreamed(
          entry.data,
          name,
          method,
          offset,
          stamp,
          directory,
        );
      } else {
        yield* this.writeWhole(
          entry.data,
          name,
          method,
          offset,
          stamp,
          directory,
        );
      }

      const written = directory[directory.length - 1];
      offset =
        written.offset +
        30 +
        name.length +
        written.compressedSize +
        (written.flags & 0x0008 ? 16 : 0);
    }

    const start = offset;
    let size = 0;
    for (const entry of directory) {
      const record = this.centralHeader(entry);
      yield record;
      size += record.length;
    }

    yield this.endOfCentralDirectory(directory.length, size, start);
  }

  /**
   * An entry whose bytes are already in hand: sizes and CRC are known before
   * the header is written, so no data descriptor is needed.
   */
  protected async *writeWhole(
    data: Uint8Array<ArrayBuffer>,
    name: Uint8Array,
    method: number,
    offset: number,
    stamp: { dosDate: number; dosTime: number },
    directory: ZipDirectoryRecord[],
  ): AsyncGenerator<Uint8Array> {
    // CRC-32 covers the ORIGINAL bytes, never the compressed ones.
    const crc = this.finish(this.update(0xffffffff, data));
    const payload = method === 0 ? data : await this.deflate(data);

    const record: ZipDirectoryRecord = {
      name,
      method,
      flags: 0x0800,
      crc,
      compressedSize: payload.length,
      size: data.length,
      offset,
      ...stamp,
    };
    this.assertWritable(record, offset);

    yield this.localHeader(record);
    yield payload;
    directory.push(record);
  }

  /**
   * An entry read from a stream: the header goes out with zeros and bit 3
   * set, the payload is forwarded chunk by chunk while the CRC and both
   * sizes accumulate, and the real values follow in a data descriptor.
   */
  protected async *writeStreamed(
    source: ReadableStream<Uint8Array<ArrayBuffer>>,
    name: Uint8Array,
    method: number,
    offset: number,
    stamp: { dosDate: number; dosTime: number },
    directory: ZipDirectoryRecord[],
  ): AsyncGenerator<Uint8Array> {
    let crc = 0xffffffff;
    let size = 0;
    let compressedSize = 0;

    // The CRC and the uncompressed size must be measured BEFORE compression,
    // so the meter sits upstream of the CompressionStream rather than around
    // the bytes we end up writing.
    const metered = source.pipeThrough(
      new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
        transform: (chunk, controller) => {
          size += chunk.length;
          // Checked here rather than only at the end so an oversized source
          // fails at the boundary instead of after being read in full.
          if (size > ZIP64_LIMIT) {
            throw new AlephaError(
              "ZipArchive: entry exceeds the 4 GB ZIP64 boundary (no ZIP64 support)",
            );
          }
          crc = this.update(crc, chunk);
          controller.enqueue(chunk);
        },
      }),
    );
    const payload: ReadableStream<Uint8Array> =
      method === 0
        ? metered
        : // A `Uint8Array<ArrayBuffer>` IS a `BufferSource`; the cast is only
          // needed because TypeScript treats the transform's `WritableStream`
          // type parameter as invariant.
          (metered as unknown as ReadableStream<BufferSource>).pipeThrough(
            new CompressionStream("deflate-raw"),
          );

    const record: ZipDirectoryRecord = {
      name,
      method,
      flags: 0x0800 | 0x0008,
      crc: 0,
      compressedSize: 0,
      size: 0,
      offset,
      ...stamp,
    };
    yield this.localHeader(record);

    const reader = payload.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        compressedSize += value.length;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }

    record.crc = this.finish(crc);
    record.compressedSize = compressedSize;
    record.size = size;
    this.assertWritable(record, offset);

    yield this.dataDescriptor(record);
    directory.push(record);
  }

  /**
   * Rejects anything that would need ZIP64. Writing it anyway would produce
   * an archive that looks fine and does not open.
   */
  protected assertWritable(record: ZipDirectoryRecord, offset: number): void {
    if (record.size > ZIP64_LIMIT || record.compressedSize > ZIP64_LIMIT) {
      throw new AlephaError(
        "ZipArchive: entry exceeds the 4 GB ZIP64 boundary (no ZIP64 support)",
      );
    }
    if (offset > ZIP64_LIMIT) {
      throw new AlephaError(
        "ZipArchive: archive exceeds the 4 GB ZIP64 boundary (no ZIP64 support)",
      );
    }
  }

  /**
   * Packs an instant into the two 16-bit fields ZIP stores it in.
   *
   * DOS date is `(year - 1980) << 9 | month << 5 | day` with month and day
   * 1-based; DOS time is `hour << 11 | minute << 5 | second / 2`, which is
   * why ZIP timestamps have two-second resolution. Read in UTC so the output
   * does not vary with the machine's timezone.
   *
   * Anything before 1980 or after 2107 is clamped to the nearest end of the
   * representable range: a timestamp is not worth failing an archive over,
   * and letting it overflow would write a date that decodes to nonsense.
   */
  protected dosStamp(value: Date | number | undefined): {
    dosDate: number;
    dosTime: number;
  } {
    const floor = { dosDate: (1 << 5) | 1, dosTime: 0 };
    if (value === undefined) {
      return floor;
    }

    const at = typeof value === "number" ? new Date(value) : value;
    const year = at.getUTCFullYear();
    if (Number.isNaN(year) || year < 1980) {
      return floor;
    }
    if (year > 2107) {
      return {
        dosDate: (127 << 9) | (12 << 5) | 31,
        dosTime: (23 << 11) | (59 << 5) | 29,
      };
    }

    return {
      dosDate:
        ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
      dosTime:
        (at.getUTCHours() << 11) |
        (at.getUTCMinutes() << 5) |
        (at.getUTCSeconds() >> 1),
    };
  }

  /**
   * Local file header — 30 fixed bytes followed by the name.
   */
  protected localHeader(entry: ZipDirectoryRecord): Uint8Array {
    const buffer = new Uint8Array(30 + entry.name.length);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, entry.flags, true);
    view.setUint16(8, entry.method, true);
    view.setUint16(10, entry.dosTime, true);
    view.setUint16(12, entry.dosDate, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.compressedSize, true);
    view.setUint32(22, entry.size, true);
    view.setUint16(26, entry.name.length, true);
    buffer.set(entry.name, 30);
    return buffer;
  }

  /**
   * Data descriptor — the real CRC and sizes, written after a streamed
   * payload because the header could not carry them.
   */
  protected dataDescriptor(entry: ZipDirectoryRecord): Uint8Array {
    const buffer = new Uint8Array(16);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, 0x08074b50, true);
    view.setUint32(4, entry.crc, true);
    view.setUint32(8, entry.compressedSize, true);
    view.setUint32(12, entry.size, true);
    return buffer;
  }

  /**
   * Central directory header — 46 fixed bytes followed by the name.
   */
  protected centralHeader(entry: ZipDirectoryRecord): Uint8Array {
    const buffer = new Uint8Array(46 + entry.name.length);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, entry.flags, true);
    view.setUint16(10, entry.method, true);
    view.setUint16(12, entry.dosTime, true);
    view.setUint16(14, entry.dosDate, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.compressedSize, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    buffer.set(entry.name, 46);
    return buffer;
  }

  /**
   * End of central directory record — always 22 bytes, no archive comment.
   */
  protected endOfCentralDirectory(
    count: number,
    size: number,
    offset: number,
  ): Uint8Array {
    if (count > 0xffff) {
      throw new AlephaError(
        `ZipArchive: ${count} entries exceeds the 65535 ZIP64 boundary (no ZIP64 support)`,
      );
    }
    const buffer = new Uint8Array(22);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, size, true);
    view.setUint32(16, offset, true);
    return buffer;
  }

  /**
   * Raw DEFLATE (ZIP method 8) via `CompressionStream`.
   *
   * `"deflate-raw"`, never `"deflate"` — the latter wraps the payload in a
   * zlib header plus an Adler-32 trailer, which is not what ZIP method 8
   * means, and produces archives that fail on extraction.
   */
  protected async deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    const compressed = await new Response(
      source.pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer();
    return new Uint8Array(compressed);
  }

  /**
   * Folds `data` into a running CRC-32. Seed with `0xffffffff` and close with
   * {@link finish}; kept separate so a streamed entry can accumulate across
   * chunks it never holds together.
   */
  protected update(crc: number, data: Uint8Array): number {
    let table = ZipArchive.table;
    if (!table) {
      table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
          value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value;
      }
      ZipArchive.table = table;
    }

    let next = crc;
    for (let i = 0; i < data.length; i++) {
      next = table[(next ^ data[i]) & 0xff] ^ (next >>> 8);
    }
    return next;
  }

  /**
   * Closes a running CRC-32 into the value ZIP stores.
   */
  protected finish(crc: number): number {
    return (crc ^ 0xffffffff) >>> 0;
  }
}
