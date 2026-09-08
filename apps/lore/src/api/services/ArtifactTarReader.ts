import { BadRequestError, HttpError } from "alepha/server";

import {
  type ArtifactManifest,
  artifactManifestSchema,
} from "../schemas/artifactManifestSchema.ts";

/**
 * Reads an artifact's own claim about itself out of the tarball.
 *
 * `alepha pack` produces `dist/` (with `manifest.json`) plus `migrations/`,
 * gzipped. This walks that archive far enough to find `dist/manifest.json`,
 * and refuses everything else.
 *
 * ## ⚠️ Why the server does this rather than trusting a field
 *
 * The push could carry `runtime` and a manifest version as form fields, and it
 * would be one screenful shorter. It would also mean the registry never
 * verifies anything about the bytes it stores: a row would describe whatever
 * the pusher said, and the first thing to discover otherwise would be a deploy.
 * The manifest is the artifact's own claim, so reading it here is the whole
 * difference between a registry and a bucket with a table beside it.
 *
 * ## Constant memory, bounded work
 *
 * The archive is decompressed as a stream and every entry body is discarded as
 * it goes by; only `dist/manifest.json` is collected, and the scan stops the
 * moment it is complete. What is held is one chunk plus a partial header, not
 * the decompressed archive - which for a real app is tens of megabytes against
 * a Worker isolate that has about 128.
 *
 * {@link MAX_INFLATED_BYTES} bounds the other direction. Gzip expands, and a
 * 20 MB upload can legally inflate to gigabytes; without a budget the CPU cost
 * of a push would be chosen by whoever pushes.
 */
export class ArtifactTarReader {
  /**
   * Where `alepha pack` puts the manifest, and the only path accepted.
   *
   * `pack` hardcodes `dist` in its include list and refuses to run without
   * `dist/manifest.json`, so an artifact carrying it anywhere else did not come
   * from `alepha pack`.
   */
  public static readonly MANIFEST_PATH = "dist/manifest.json";

  /**
   * One tar block. Headers are one block; a body is padded up to a multiple.
   */
  protected static readonly BLOCK = 512;

  /**
   * How much decompressed archive the scan will walk before giving up.
   *
   * Far past any real artifact - a packed app is tens of megabytes - and small
   * enough that a compression bomb is a fast 400 rather than a Worker burning
   * its CPU budget.
   */
  protected static readonly MAX_INFLATED_BYTES = 256 * 1024 * 1024;

  /**
   * The manifest is a few kilobytes of JSON. A header claiming otherwise is
   * either not a manifest or is trying to make this buffer grow.
   */
  protected static readonly MAX_MANIFEST_BYTES = 1024 * 1024;

  /**
   * How much an {@link extract} will WRITE, which is a different bound from
   * how much a scan will walk past.
   *
   * ⚠️ {@link MAX_INFLATED_BYTES} is 256 MB and is not a bound here at all: it
   * was chosen for a scan that holds one chunk and throws every body away,
   * while an extraction keeps them, inside an isolate that has about 128 MB
   * for everything including the build that reads them afterwards. A packed
   * Alepha app is tens of megabytes, so this leaves room and still fits.
   */
  protected static readonly MAX_EXTRACTED_BYTES = 64 * 1024 * 1024;

  /**
   * Bounded separately from the bytes, because thousands of empty files cost
   * nothing in bytes and a great deal in a map.
   */
  protected static readonly MAX_ENTRIES = 20_000;

  /**
   * The manifest of an `alepha pack` tarball, validated.
   *
   * Every failure here is a 400 rather than a 500: an artifact that is not an
   * Alepha artifact is a bad request, and the message says which of the three
   * ways it failed so a CI log is enough to fix it.
   */
  public async readManifest(bytes: Uint8Array): Promise<ArtifactManifest> {
    const found = await this.findEntry(bytes, ArtifactTarReader.MANIFEST_PATH);
    if (!found) {
      throw new BadRequestError(
        `This artifact carries no ${ArtifactTarReader.MANIFEST_PATH}. Build it with \`alepha build\` and pack it with \`alepha pack\`.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(found));
    } catch {
      throw new BadRequestError(
        `${ArtifactTarReader.MANIFEST_PATH} is not valid JSON.`,
      );
    }

    const manifest = artifactManifestSchema.safeParse(parsed);
    if (!manifest.success) {
      throw new BadRequestError(
        `${ArtifactTarReader.MANIFEST_PATH} is not a manifest this Lore can read: it must declare \`version: 1\` and a \`runtime\` of node, bun, workerd or static.`,
      );
    }

    return manifest.data;
  }

  /**
   * The whole archive, written into a filesystem the caller supplies.
   *
   * ⚠️ **This is what a DEPLOY needs, and it is a different job from
   * {@link readManifest}.** The scan matches one exact path and discards every
   * body, so what an entry IS never mattered and nothing it holds can escape
   * anywhere. An extraction holds the bytes and writes them by name, so both
   * of those become real:
   *
   * - **Path escape.** Every name is normalised and refused if it leaves
   *   `root`, whether by `../`, by an absolute path or by a ustar `prefix`
   *   that composes one. The runner unpacks into a MemoryFS **shared with the
   *   build task**, so an escaped path is more dangerous here rather than
   *   less: it would overwrite what the build is about to read.
   * - **Symlinks.** A symlink entry has no body, so ignoring the typeflag
   *   writes a zero-byte regular file where a link was meant - or, on a real
   *   filesystem, a link pointing anywhere at all. Refused rather than
   *   followed: an `alepha pack` tarball contains none, so one is either a
   *   different tool's output or an attack.
   * - **Its own budget.** {@link MAX_INFLATED_BYTES} is 256 MB, which is not a
   *   bound at all for something that KEEPS the bytes inside a 128 MB isolate.
   *   {@link MAX_EXTRACTED_BYTES} and {@link MAX_ENTRIES} are the ones that
   *   apply here.
   *
   * Directories are created for their entries and implied by every file's
   * path, so an archive that lists no directory entries still unpacks.
   */
  public async extract(
    bytes: Uint8Array,
    fs: ArtifactTarSink,
    root: string,
    options: ArtifactTarExtractOptions = {},
  ): Promise<{ files: number; bytes: number; skipped: number }> {
    const { MAX_ENTRIES, MAX_EXTRACTED_BYTES } = ArtifactTarReader;
    let files = 0;
    let written = 0;
    let skipped = 0;

    for await (const entry of this.entries(bytes)) {
      if (++files > MAX_ENTRIES) {
        throw new BadRequestError(
          `This artifact holds more than ${MAX_ENTRIES} entries, which is more than a deploy will unpack.`,
        );
      }

      const path = this.resolveInside(root, entry.name);

      // A directory entry, and the two GNU pseudo-entries that carry a long
      // name for the NEXT record. Refusing the long-name records rather than
      // supporting them is deliberate: `alepha pack` never writes one, and a
      // half-supported one silently truncates a path to 100 characters.
      if (entry.typeflag === "5") {
        await fs.mkdir(path, { recursive: true });
        continue;
      }
      if (entry.typeflag === "L" || entry.typeflag === "K") {
        throw new BadRequestError(
          "This artifact uses GNU long-name records, which a deploy will not unpack. Repack it with a tar that writes ustar prefixes.",
        );
      }
      // A pax extended header (`x`/`g`) describes the next entry and carries
      // no file of its own, so it is skipped rather than refused.
      if (entry.typeflag === "x" || entry.typeflag === "g") {
        continue;
      }
      if (entry.typeflag === "1" || entry.typeflag === "2") {
        throw new BadRequestError(
          `This artifact contains a link (${entry.name}), which a deploy will not unpack. A link is a path that resolves somewhere this archive does not describe.`,
        );
      }
      if (entry.typeflag !== "0" && entry.typeflag !== "\0") {
        throw new BadRequestError(
          `This artifact contains an entry (${entry.name}) of a kind a deploy will not unpack.`,
        );
      }

      // ⚠️ Offered to the caller and then DROPPED, without ever reaching the
      // filesystem. This is what lets a deploy walk a 49 MB asset tree inside
      // a 128 MB isolate: the bytes exist for the length of one callback.
      // They are deliberately not counted against MAX_EXTRACTED_BYTES, which
      // bounds what is KEPT; the walk itself is bounded by
      // MAX_INFLATED_BYTES, as it is for `readManifest`.
      if (options.skip?.(path)) {
        skipped++;
        await options.onSkipped?.(path, entry.body);
        continue;
      }

      written += entry.body.length;
      if (written > MAX_EXTRACTED_BYTES) {
        throw new BadRequestError(
          "This artifact unpacks to more than a deploy will hold in memory.",
        );
      }

      const slash = path.lastIndexOf("/");
      if (slash > 0) {
        await fs.mkdir(path.slice(0, slash), { recursive: true });
      }
      await fs.writeFile(path, entry.body);
    }

    return { files, bytes: written, skipped };
  }

  /**
   * Where one entry lands, refused if that is not under `root`.
   *
   * ⚠️ Compared after normalising, and with a trailing slash on the root, so
   * `/deploy-evil` is not accepted as being inside `/deploy`.
   */
  protected resolveInside(root: string, name: string): string {
    const base = root.endsWith("/") ? root.slice(0, -1) : root;
    const segments: string[] = [];
    for (const segment of name.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        throw new BadRequestError(
          `This artifact contains a path that climbs out of the archive (${name}).`,
        );
      }
      segments.push(segment);
    }
    if (segments.length === 0 || name.startsWith("/")) {
      throw new BadRequestError(
        `This artifact contains a path a deploy will not unpack (${name}).`,
      );
    }
    return `${base}/${segments.join("/")}`;
  }

  /**
   * One entry's body, or `undefined` when the archive does not carry it.
   *
   * Stops at the wanted entry rather than walking the rest, which is what
   * keeps a manifest read cheap on a 40 MB archive.
   */
  protected async findEntry(
    bytes: Uint8Array,
    wanted: string,
  ): Promise<Uint8Array | undefined> {
    for await (const entry of this.entries(bytes, {
      only: wanted,
      maxBody: ArtifactTarReader.MAX_MANIFEST_BYTES,
    })) {
      if (entry.name === wanted) {
        return entry.body;
      }
    }
    return undefined;
  }

  /**
   * Every entry in the archive, decompressed as a stream.
   *
   * ⚠️ **One walk, two callers**, and that is the point of it being a
   * generator. `readManifest` needs one file and `extract` needs all of them,
   * but the ustar boundary arithmetic, the gzip budget and the
   * end-of-archive rule are identical - and a second copy of a streaming tar
   * walk is a copy that drifts silently, in a reader whose whole job is to
   * refuse malformed input.
   *
   * `only` is the scan's optimisation and nothing more: an entry that is not
   * wanted has its body skipped rather than collected, so memory stays at one
   * chunk plus a partial header. Without it every body is collected, which is
   * what an extraction needs and why the budget it applies is its own.
   */
  protected async *entries(
    bytes: Uint8Array,
    options: { only?: string; maxBody?: number } = {},
  ): AsyncGenerator<ArtifactTarEntry & { body: Uint8Array }> {
    const { BLOCK, MAX_INFLATED_BYTES } = ArtifactTarReader;
    // ⚠️ Bad gzip does NOT fail here. `pipeThrough` only wires the streams up;
    // the inflate error surfaces on the first `read()`, which is why the guard
    // below is around the loop and not around this line.
    const reader = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader();
    // Only ever holds a partial header, so it stays under one block.
    let carry = new Uint8Array(0);
    let skip = 0;
    let capture: number | undefined;
    let pending: ArtifactTarEntry | undefined;
    const collected: Uint8Array[] = [];
    let inflated = 0;
    let finished = false;
    // A generator's consumer can stop early, and the `finally` below is what
    // then closes the stream. Anything it yields has to be produced outside
    // the try/catch, or a `break` would be caught and reported as bad gzip.
    const ready: Array<ArtifactTarEntry & { body: Uint8Array }> = [];

    try {
      while (!finished) {
        const next = await reader.read();
        if (next.done) break;
        let chunk = next.value;
        inflated += chunk.length;
        if (inflated > MAX_INFLATED_BYTES) {
          throw new BadRequestError(
            "This artifact decompresses to more than this registry will read.",
          );
        }

        while (chunk.length > 0) {
          if (capture !== undefined && pending) {
            const take = Math.min(capture, chunk.length);
            collected.push(chunk.subarray(0, take));
            capture -= take;
            chunk = chunk.subarray(take);
            if (capture === 0) {
              ready.push({ ...pending, body: this.concat(collected) });
              collected.length = 0;
              capture = undefined;
              // The body's padding is the next entry's problem.
              skip = Math.ceil(pending.size / BLOCK) * BLOCK - pending.size;
              pending = undefined;
              if (options.only) {
                finished = true;
                break;
              }
            }
            continue;
          }

          if (skip > 0) {
            const take = Math.min(skip, chunk.length);
            skip -= take;
            chunk = chunk.subarray(take);
            continue;
          }

          if (carry.length + chunk.length < BLOCK) {
            carry = this.concat([carry, chunk]);
            break;
          }

          const need = BLOCK - carry.length;
          const header = this.concat([carry, chunk.subarray(0, need)]);
          carry = new Uint8Array(0);
          chunk = chunk.subarray(need);

          const entry = this.parseHeader(header);
          // A zeroed block is the end-of-archive marker, and an unparseable
          // one is an archive this reader has no business guessing about.
          if (!entry) {
            finished = true;
            break;
          }

          const collect =
            (!options.only || entry.name === options.only) &&
            (options.maxBody === undefined || entry.size <= options.maxBody);

          if (collect && entry.size > 0) {
            pending = entry;
            capture = entry.size;
          } else if (collect) {
            // A zero-length file still exists, and a directory entry has no
            // body at all: both are yielded without a capture step.
            ready.push({ ...entry, body: new Uint8Array(0) });
            if (options.only && entry.name === options.only) {
              finished = true;
              break;
            }
          } else {
            skip = Math.ceil(entry.size / BLOCK) * BLOCK;
          }
        }

        if (ready.length > 0) {
          // Yielded outside the inner loop so the buffer stays small, and
          // still inside the try so the stream is closed on an early return.
          for (const entry of ready.splice(0, ready.length)) {
            yield entry;
          }
        }
      }
    } catch (error) {
      // The budget refusal is already the right answer, with the right status.
      if (HttpError.is(error)) {
        throw error;
      }
      // Everything else here is the inflate failing, which means the upload is
      // not a gzip archive at all. A 500 would blame Lore for a bad request.
      throw new BadRequestError(
        "This artifact could not be decompressed: it is not a gzip archive.",
      );
    } finally {
      // Cancelling a stream that has ERRORED rejects with that same error, so
      // the rejection is swallowed here rather than replacing the message that
      // was chosen to describe it.
      await reader.cancel().catch(() => undefined);
    }

    for (const entry of ready) {
      yield entry;
    }
  }

  /**
   * The two fields a walk needs: what the entry is called and how long it is.
   *
   * `undefined` for the end-of-archive marker (a zeroed block) and for anything
   * whose size field is not octal, which is how a stream that is not a tar
   * stops the walk instead of producing nonsense offsets.
   */
  protected parseHeader(header: Uint8Array): ArtifactTarEntry | undefined {
    if (header.every((byte) => byte === 0)) {
      return undefined;
    }

    const name = this.trimmed(header.subarray(0, 100));
    if (!name) {
      return undefined;
    }

    const size = this.octal(header.subarray(124, 136));
    if (size === undefined) {
      return undefined;
    }

    // ⚠️ Offset 156, and it exists for {@link extract} rather than for the
    // manifest scan. A scan matches one exact name and throws every body away,
    // so what an entry IS never mattered; an extraction that ignores this
    // writes a SYMLINK entry out as a regular file, which is a second
    // path-escape vector beside `../`, and writes GNU long-name records out as
    // files called `././@LongLink`.
    const typeflag = this.trimmed(header.subarray(156, 157)) || "0";

    // ustar's `prefix` field carries the leading directories of a long path,
    // and `dist/manifest.json` is far too short to ever use it - but an
    // archive built by some other tool might, and silently reading the tail as
    // the whole name would match the wrong entry.
    const prefix = this.trimmed(header.subarray(345, 500));
    const full = prefix ? `${prefix}/${name}` : name;

    // GNU tar writes `./dist/manifest.json` when handed `.`; BSD tar does not.
    return { name: full.replace(/^\.\//, ""), size, typeflag };
  }

  /**
   * A NUL-padded header field as a string.
   */
  protected trimmed(field: Uint8Array): string {
    const end = field.indexOf(0);
    const bytes = end === -1 ? field : field.subarray(0, end);
    return new TextDecoder().decode(bytes).trim();
  }

  /**
   * A tar size field: octal digits, NUL- or space-padded.
   *
   * `undefined` rather than 0 for anything else. Zero is a legitimate size (an
   * empty file), so conflating the two would walk a malformed archive forever
   * one block at a time.
   */
  protected octal(field: Uint8Array): number | undefined {
    const text = this.trimmed(field).replace(/\0+$/, "").trim();
    if (!/^[0-7]+$/.test(text)) {
      return undefined;
    }
    return Number.parseInt(text, 8);
  }

  protected concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/**
 * One tar entry's header, as much of it as this reader reads.
 */
export interface ArtifactTarEntry {
  name: string;
  size: number;
  /**
   * The ustar type: `0` (or NUL) a regular file, `5` a directory, `2` a
   * symlink, `1` a hard link, `L`/`K` GNU long-name records, `x`/`g` pax
   * extended headers.
   */
  typeflag: string;
}

/**
 * The slice of `FileSystemProvider` an extraction writes through.
 *
 * Named rather than taken whole so `extract` can be driven by a fake in a
 * spec, and so it is obvious that unpacking creates directories and writes
 * files and does nothing else.
 */
/**
 * What an extraction may leave out.
 *
 * ⚠️ **The reason this exists is memory, not taste.** `extract` writes every
 * entry into a `MemoryFileSystemProvider`, so a site whose `dist/public` is
 * 49 MB is 49 MB of isolate before the build has read a byte, and `apps/docs`
 * died exactly there with `Worker exceeded memory limit`. A deploy does not
 * need those files in a filesystem: it needs their hashes now and their bytes
 * later, one upload batch at a time.
 *
 * So a skipped entry is still WALKED and still handed to {@link onSkipped} -
 * it is only never stored.
 */
export interface ArtifactTarExtractOptions {
  /**
   * Answer true for an entry that must not be written. It is called with the
   * resolved path, so a caller matches on where the entry landed rather than
   * on what the archive called it.
   */
  skip?: (path: string) => boolean;

  /**
   * Each skipped entry, with bytes that are valid only until this resolves.
   *
   * ⚠️ Keeping a reference defeats the whole point: the body is a view into a
   * buffer the walk is about to move past, and holding every one of them is
   * the memory this option exists to avoid.
   */
  onSkipped?: (path: string, body: Uint8Array) => Promise<void> | void;
}

export interface ArtifactTarSink {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<unknown>;
}
