import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { constants as zlibConstants, createZstdCompress } from "node:zlib";

/**
 * Compress one file into another with zstd, at the window the artifact format
 * pins.
 *
 * ## ⚠️ Why this is a service rather than a method on the packer
 *
 * It is the one step of `alepha pack` that cannot go through
 * `FileSystemProvider`: a zstd stream operates on real descriptors, and its
 * input is a tar a real `tar` binary just wrote. So a spec running against
 * `MemoryShellProvider` — where no tar was ever produced — has nothing for it
 * to read, and every spec that drives the packer to assert a shell command
 * would fail on a step it is not about.
 *
 * Injected, it substitutes the way everything else in this codebase does:
 * `.with({ provide: ArchiveCompressor, use: MemoryArchiveCompressor })`. The
 * compression itself is then measured where it can be, against real files, in
 * `WorkspacePackerZstd.spec.ts`.
 */
export class ArchiveCompressor {
  /**
   * The zstd window, as a base-2 exponent: 25 is 32 MiB.
   *
   * ⚠️ **It must span the DISTANCE between two copies of the same chunk**, not
   * the whole archive. A multi-slice artifact writes its slices one after
   * another, so that distance is roughly one slice. Measured on Lore's real
   * two-slice tar (61 MB uncompressed): 7.14 MB at the default window,
   * 6.52 MB at 23, 5.77 MB at 24, and 5.69 MB at 25, 26 and 27 alike. 25 is
   * where the curve flattens.
   *
   * ⚠️ **The window is a DECODER cost too**, which is what makes the ceiling
   * real rather than a tuning preference. Lore ingests artifacts inside a
   * Cloudflare Worker with about 128 MB of isolate memory, decoding zstd in
   * JavaScript because workerd has no native zstd; a frame declaring a 128 MiB
   * window would ask that isolate for its whole budget to read a 5.69 MB file.
   *
   * ⚠️ **Every decoder must allow at least this much.** Bay caps itself with
   * `maxZstdWindow` in `internal/deploy/deploy.go`, and a decoder unwilling to
   * allocate a window this large refuses the archive outright.
   */
  public static readonly WINDOW_LOG = 25;

  /**
   * The compression level.
   *
   * 10 rather than the default 3: measured at 196 ms for Lore's 61 MB archive
   * against 686 ms for `gzip -9` on the same bytes, so the higher level costs
   * nothing an operator would notice and is still three times faster than what
   * it replaces.
   */
  public static readonly LEVEL = 10;

  /**
   * Stream `input` through zstd into `output`.
   *
   * Streamed rather than buffered: Lore's uncompressed archive is 61 MB and
   * every slice added is another 30.
   */
  async compress(input: string, output: string): Promise<void> {
    await pipeline(
      createReadStream(input),
      createZstdCompress({
        params: {
          [zlibConstants.ZSTD_c_compressionLevel]: ArchiveCompressor.LEVEL,
          [zlibConstants.ZSTD_c_windowLog]: ArchiveCompressor.WINDOW_LOG,
        },
      }),
      createWriteStream(output),
    );
  }
}

/**
 * An {@link ArchiveCompressor} that records what it was asked to compress and
 * touches no disk.
 *
 * For specs that drive `alepha pack` to assert the shell command it builds:
 * the tar never exists there, because the shell is a fake.
 */
export class MemoryArchiveCompressor extends ArchiveCompressor {
  public readonly calls: Array<{ input: string; output: string }> = [];

  async compress(input: string, output: string): Promise<void> {
    this.calls.push({ input, output });
  }
}
