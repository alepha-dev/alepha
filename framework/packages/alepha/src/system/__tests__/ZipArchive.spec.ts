import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Alepha, AlephaError } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";

import { AlephaSystem } from "../index.ts";
import { ZipArchive } from "../services/ZipArchive.ts";

const execFileAsync = promisify(execFile);

/**
 * Runs the real Info-ZIP `unzip` over an archive and returns its verdict.
 *
 * The hand-rolled {@link readZip} below can only prove the writer agrees with
 * itself about layout. Only a foreign implementation checks the parts our own
 * reader has no reason to look at — above all the CRC-32, which `unzip -t`
 * verifies per entry and which nothing else here would catch.
 */
const unzipTest = async (
  bytes: Uint8Array,
): Promise<{ ok: boolean; output: string }> => {
  const directory = await mkdtemp(join(tmpdir(), "alepha-zip-"));
  const archive = join(directory, "archive.zip");
  try {
    await writeFile(archive, bytes);
    const { stdout } = await execFileAsync("unzip", ["-t", archive]);
    return { ok: true, output: stdout };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

/**
 * Minimal ZIP reader used only to verify what {@link ZipArchive} writes.
 *
 * Deliberately independent of the writer: it parses the End Of Central
 * Directory record, walks the central directory, and reads each entry back
 * through its LOCAL header. A helper that reused the writer's own offsets
 * would pass even if the offsets were wrong, which is the single most likely
 * way to get a ZIP subtly incorrect.
 */
const readZip = async (
  bytes: Uint8Array<ArrayBuffer>,
): Promise<
  Array<{
    name: string;
    content: Uint8Array;
    method: number;
    dosTime: number;
    dosDate: number;
  }>
> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End Of Central Directory: scan back for its signature (no comment
  // support needed — the writer never emits one).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record");

  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  const entries: Array<{
    name: string;
    content: Uint8Array;
    method: number;
    dosTime: number;
    dosDate: number;
  }> = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      throw new Error(`bad central directory header at ${pointer}`);
    }
    const method = view.getUint16(pointer + 10, true);
    const dosTime = view.getUint16(pointer + 12, true);
    const dosDate = view.getUint16(pointer + 14, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(pointer + 46, pointer + 46 + nameLength),
    );

    // Re-read the name/extra lengths from the LOCAL header — they are allowed
    // to differ from the central copy, and using the central ones to skip
    // would silently read from the wrong offset.
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`bad local header for ${name}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    const content =
      method === 0
        ? raw
        : new Uint8Array(
            await new Response(
              new ReadableStream<BufferSource>({
                start(controller) {
                  controller.enqueue(raw);
                  controller.close();
                },
              }).pipeThrough(new DecompressionStream("deflate-raw")),
            ).arrayBuffer(),
          );

    entries.push({ name, content, method, dosTime, dosDate });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};

const collect = async (
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await new Response(stream).arrayBuffer());

const utf8 = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text);

describe("ZipArchive", () => {
  let zip: ZipArchive;

  beforeEach(() => {
    const alepha = Alepha.create().with(AlephaSystem);
    zip = alepha.inject(ZipArchive);
  });

  describe("create", () => {
    it("should write a single stored entry that reads back unchanged", async () => {
      const stream = zip.create([
        { name: "hello.md", data: utf8("# Hello"), method: "store" },
      ]);

      const entries = await readZip(await collect(stream));

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("hello.md");
      expect(entries[0].method).toBe(0);
      expect(new TextDecoder().decode(entries[0].content)).toBe("# Hello");
    });

    it("should write a CRC-32 that the real unzip accepts", async () => {
      const stream = zip.create([
        { name: "hello.md", data: utf8("# Hello"), method: "store" },
      ]);

      const result = await unzipTest(await collect(stream));

      expect(result.output).toContain("No errors detected");
      expect(result.ok).toBe(true);
    });

    it("should compress a deflated entry and read it back unchanged", async () => {
      const text = "# Title\n\n".concat("compress me. ".repeat(200));

      const stream = zip.create([
        { name: "notes.md", data: utf8(text), method: "deflate" },
      ]);
      const bytes = await collect(stream);
      const entries = await readZip(bytes);

      expect(entries[0].method).toBe(8);
      expect(new TextDecoder().decode(entries[0].content)).toBe(text);
      // The whole archive, headers included, beats the raw text — proof the
      // payload was actually deflated rather than stored under method 8.
      expect(bytes.length).toBeLessThan(text.length);
    });

    it("should accept a streamed entry whose size is not known upfront", async () => {
      const chunks = ["first chunk. ", "second chunk. ", "third chunk."];
      const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(utf8(chunk));
          controller.close();
        },
      });

      const stream = zip.create([
        { name: "streamed.txt", data: source, method: "store" },
      ]);
      const bytes = await collect(stream);
      const entries = await readZip(bytes);

      expect(new TextDecoder().decode(entries[0].content)).toBe(
        chunks.join(""),
      );
      // The real unzip is what proves the data descriptor is right — a wrong
      // one still reads back fine through our own helper, which trusts the
      // central directory.
      const result = await unzipTest(bytes);
      expect(result.output).toContain("No errors detected");
    });

    it("should write several entries with per-entry methods and nested paths", async () => {
      const stream = zip.create([
        { name: "notes.md", data: utf8("# Notes"), method: "deflate" },
        { name: "assets/photo.webp", data: utf8("fake-webp"), method: "store" },
        { name: "assets/deep/other.bin", data: utf8("xx"), method: "store" },
      ]);
      const bytes = await collect(stream);
      const entries = await readZip(bytes);

      expect(entries.map((entry) => entry.name)).toEqual([
        "notes.md",
        "assets/photo.webp",
        "assets/deep/other.bin",
      ]);
      expect(entries.map((entry) => entry.method)).toEqual([8, 0, 0]);
      const result = await unzipTest(bytes);
      expect(result.output).toContain("No errors detected");
    });

    it("should write a non-ASCII filename readable back as UTF-8", async () => {
      const stream = zip.create([
        { name: "notes/été-Ω.md", data: utf8("accents"), method: "store" },
      ]);

      const entries = await readZip(await collect(stream));

      expect(entries[0].name).toBe("notes/été-Ω.md");
    });

    it("should write an empty entry", async () => {
      const stream = zip.create([
        { name: "empty.txt", data: utf8(""), method: "deflate" },
      ]);
      const bytes = await collect(stream);
      const entries = await readZip(bytes);

      expect(entries[0].content).toHaveLength(0);
      const result = await unzipTest(bytes);
      expect(result.output).toContain("No errors detected");
    });

    it("should record a given lastModified as its DOS date and time", async () => {
      // 2026-08-14 13:45:522026 - 1980 = 46 → date = (46<<9)|(8<<5)|14
      //                                  time = (13<<11)|(45<<5)|(52>>1)
      const stream = zip.create([
        {
          name: "dated.txt",
          data: utf8("x"),
          method: "store",
          lastModified: new Date("2026-08-14T13:45:52Z"),
        },
      ]);

      const entries = await readZip(await collect(stream));

      expect(entries[0].dosDate).toBe((46 << 9) | (8 << 5) | 14);
      expect(entries[0].dosTime).toBe((13 << 11) | (45 << 5) | (52 >> 1));
    });

    it("should default to the start of the DOS epoch rather than an invalid date", async () => {
      // DOS packs day and month as 1-based, so all-zero bytes decode to day 0
      // of month 0 — a date no extractor can render. The default has to be a
      // real instant, and a fixed one, or identical input stops producing
      // identical bytes.
      const stream = zip.create([
        { name: "undated.txt", data: utf8("x"), method: "store" },
      ]);

      const entries = await readZip(await collect(stream));

      expect(entries[0].dosDate).toBe((0 << 9) | (1 << 5) | 1);
      expect(entries[0].dosTime).toBe(0);
    });

    it("should produce identical bytes for identical input", async () => {
      const build = async () =>
        collect(
          zip.create([
            { name: "notes.md", data: utf8("# Notes"), method: "deflate" },
            { name: "assets/a.bin", data: utf8("aaaa"), method: "store" },
          ]),
        );

      expect(Array.from(await build())).toEqual(Array.from(await build()));
    });
  });

  /**
   * The ZIP64 boundaries are asserted against the guards directly rather than
   * by feeding the writer 4 GB: the honest end-to-end version spent twelve
   * seconds pushing five gigabytes through the CRC to reach a branch that
   * takes one comparison. Driving the protected methods through a subclass is
   * the pattern the repo already uses for exactly this (see CLAUDE.md,
   * "TestProvider Pattern").
   */
  describe("ZIP64 boundaries", () => {
    let guards: TestZipArchive;

    beforeEach(() => {
      const alepha = Alepha.create().with(AlephaSystem);
      guards = alepha.inject(TestZipArchive);
    });

    it("should refuse an entry larger than 4 GB", () => {
      expect(() =>
        guards.testAssertWritable(
          { ...record, size: 0x1_0000_0000, compressedSize: 10 },
          0,
        ),
      ).toThrow(AlephaError);
    });

    it("should refuse a compressed entry larger than 4 GB", () => {
      expect(() =>
        guards.testAssertWritable(
          { ...record, size: 10, compressedSize: 0x1_0000_0000 },
          0,
        ),
      ).toThrow(AlephaError);
    });

    it("should refuse an archive that grows past 4 GB", () => {
      expect(() => guards.testAssertWritable(record, 0x1_0000_0000)).toThrow(
        AlephaError,
      );
    });

    it("should refuse more than 65535 entries", () => {
      expect(() => guards.testEndOfCentralDirectory(0x10000, 100, 100)).toThrow(
        AlephaError,
      );
    });

    it("should accept an entry exactly at the boundary", () => {
      expect(() =>
        guards.testAssertWritable(
          { ...record, size: 0xffffffff, compressedSize: 0xffffffff },
          0xffffffff,
        ),
      ).not.toThrow();
    });
  });
});

/**
 * A record that sits well inside every limit, so each boundary test changes
 * exactly the one field it is about.
 */
const record = {
  name: new TextEncoder().encode("x.bin"),
  method: 0,
  flags: 0x0800,
  crc: 0,
  compressedSize: 10,
  size: 10,
  offset: 0,
  dosDate: (1 << 5) | 1,
  dosTime: 0,
};

/**
 * Exposes the guards for direct assertion — see the `describe` above.
 */
class TestZipArchive extends ZipArchive {
  public testAssertWritable = this.assertWritable.bind(this);
  public testEndOfCentralDirectory = this.endOfCentralDirectory.bind(this);
}
