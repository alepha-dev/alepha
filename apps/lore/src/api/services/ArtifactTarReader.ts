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
   * One entry's body, or `undefined` when the archive does not carry it.
   *
   * Deliberately not a general tar extractor. It understands the ustar header
   * well enough to walk entry boundaries and read one short file, and anything
   * it cannot make sense of ends the walk rather than being guessed at.
   */
  protected async findEntry(
    bytes: Uint8Array,
    wanted: string,
  ): Promise<Uint8Array | undefined> {
    const { BLOCK, MAX_INFLATED_BYTES, MAX_MANIFEST_BYTES } = ArtifactTarReader;
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
    const collected: Uint8Array[] = [];
    let inflated = 0;
    let finished = false;

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
          if (capture !== undefined) {
            const take = Math.min(capture, chunk.length);
            collected.push(chunk.subarray(0, take));
            capture -= take;
            chunk = chunk.subarray(take);
            // The body is complete. Its padding is the next entry's problem,
            // and there is no next entry as far as this scan is concerned.
            if (capture === 0) {
              finished = true;
              break;
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

          if (
            entry.name === wanted &&
            entry.size > 0 &&
            entry.size <= MAX_MANIFEST_BYTES
          ) {
            capture = entry.size;
          } else {
            skip = Math.ceil(entry.size / BLOCK) * BLOCK;
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
    }

    // Only on the way out normally. Cancelling a stream that has ERRORED
    // rejects with that same error, so attempting it above would replace the
    // message just chosen with the one it was chosen to replace.
    await reader.cancel();

    if (capture !== 0 || collected.length === 0) {
      return undefined;
    }
    return this.concat(collected);
  }

  /**
   * The two fields a walk needs: what the entry is called and how long it is.
   *
   * `undefined` for the end-of-archive marker (a zeroed block) and for anything
   * whose size field is not octal, which is how a stream that is not a tar
   * stops the walk instead of producing nonsense offsets.
   */
  protected parseHeader(
    header: Uint8Array,
  ): { name: string; size: number } | undefined {
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

    // ustar's `prefix` field carries the leading directories of a long path,
    // and `dist/manifest.json` is far too short to ever use it - but an
    // archive built by some other tool might, and silently reading the tail as
    // the whole name would match the wrong entry.
    const prefix = this.trimmed(header.subarray(345, 500));
    const full = prefix ? `${prefix}/${name}` : name;

    // GNU tar writes `./dist/manifest.json` when handed `.`; BSD tar does not.
    return { name: full.replace(/^\.\//, ""), size };
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
