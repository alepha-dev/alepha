import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  constants as zlibConstants,
  gzipSync,
  zstdCompressSync,
} from "node:zlib";

import { Alepha } from "alepha";
import { afterAll, describe, it } from "vitest";

import { ArchiveCompressor } from "../services/ArchiveCompressor.ts";

/**
 * ⚠️ **The sharpest trap in the multi-slice artifact, pinned by measurement.**
 *
 * A `--runtime node,workerd` build writes two near-identical copies of the same
 * bundle, megabytes apart. DEFLATE's match window is 32 KB, so gzip never sees
 * the second copy and the archive is simply twice the size. zstd with
 * long-range matching does see it — but only if its window spans the distance
 * between the two copies, and at the DEFAULT window it does not.
 *
 * Nothing fails when it does not. The archive is just twice the size it should
 * be, at gzip-like ratios with extra machinery, and the only way to notice is
 * to weigh it. That is why {@link ArchiveCompressor.WINDOW_LOG} is pinned
 * explicitly AND the ratio is asserted here: a pinned value alone drifts as
 * apps outgrow it, and an assertion alone never sets it.
 *
 * These cases run against real files, because this is the one step of
 * `alepha pack` that reaches `node:fs` and `node:zlib` directly — a zstd
 * stream operates on descriptors, not on a memory file system. That is also
 * why it is its own injectable service: every other pack spec substitutes it.
 */
describe("the archive compressor's zstd settings", () => {
  const roots: string[] = [];

  afterAll(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  const compressor = () => Alepha.create().inject(ArchiveCompressor);

  const workspace = async () => {
    const root = await mkdtemp(join(tmpdir(), "alepha-pack-zstd-"));
    roots.push(root);
    return root;
  };

  /**
   * One server slice's worth of bytes.
   *
   * Incompressible on its own (random), so the only thing a compressor can win
   * on is the duplicate — which is exactly the property under test. Real
   * bundles compress well too, and that would hide the effect behind a ratio
   * that looks fine for the wrong reason.
   *
   * 6 MiB so the two copies sit far enough apart to exceed the default window
   * by a wide margin, while keeping the case fast.
   */
  const SLICE_BYTES = 6 * 1024 * 1024;

  const sizeOf = async (path: string) => (await stat(path)).size;

  it("dedups a duplicated slice instead of storing it twice", async ({
    expect,
  }) => {
    const root = await workspace();
    const slice = randomBytes(SLICE_BYTES);

    const one = join(root, "one.tar");
    const two = join(root, "two.tar");
    await writeFile(one, slice);
    await writeFile(two, Buffer.concat([slice, slice]));

    const oneOut = join(root, "one.zst");
    const twoOut = join(root, "two.zst");
    await compressor().compress(one, oneOut);
    await compressor().compress(two, twoOut);

    const ratio = (await sizeOf(twoOut)) / (await sizeOf(oneOut));

    // Twice the input, essentially the same archive. A regression here reads
    // as ~2.0, which is what "the dedup silently stopped happening" looks
    // like from the outside.
    expect(ratio).toBeLessThan(1.1);
  });

  /**
   * The control, and the reason the case above is not just asserting that zstd
   * is good at random data. At the default window the SAME bytes double.
   */
  it("would have doubled at the default window, and does under gzip", async ({
    expect,
  }) => {
    const slice = randomBytes(SLICE_BYTES);
    const one = slice;
    const two = Buffer.concat([slice, slice]);

    const level = {
      [zlibConstants.ZSTD_c_compressionLevel]: ArchiveCompressor.LEVEL,
    };
    const defaultWindow =
      zstdCompressSync(two, { params: level }).length /
      zstdCompressSync(one, { params: level }).length;
    const gzip =
      gzipSync(two, { level: 9 }).length / gzipSync(one, { level: 9 }).length;

    expect(defaultWindow).toBeGreaterThan(1.8);
    expect(gzip).toBeGreaterThan(1.8);
  });

  /**
   * ⚠️ The window is a decoder cost as much as an encoder setting. Lore reads
   * artifacts inside a Cloudflare Worker with about 128 MB of isolate memory,
   * decoding zstd in JavaScript because workerd has no native zstd, and a
   * frame declaring a 128 MiB window would ask for that whole budget to read a
   * few megabytes. Measured on Lore's real archive, the win is already fully
   * realised at 32 MiB, so anything larger is pure cost.
   */
  it("pins a window that is large enough and no larger", ({ expect }) => {
    expect(ArchiveCompressor.WINDOW_LOG).toBe(25);
    expect(2 ** ArchiveCompressor.WINDOW_LOG).toBe(32 * 1024 * 1024);
  });

  it("writes a real zstd frame that round-trips", async ({ expect }) => {
    const root = await workspace();
    const input = join(root, "in.tar");
    const output = join(root, "out.zst");
    const body = Buffer.concat([
      Buffer.from("alepha artifact\n"),
      randomBytes(1024),
    ]);
    await writeFile(input, body);

    await compressor().compress(input, output);

    const packed = await readFile(output);
    // The little-endian zstd magic. Bay and Lore both sniff exactly this to
    // choose a decoder, never the file name.
    expect([...packed.subarray(0, 4)]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);

    const { zstdDecompressSync } = await import("node:zlib");
    expect(zstdDecompressSync(packed).equals(body)).toBe(true);
  });
});
