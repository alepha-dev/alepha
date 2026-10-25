import { $inject } from "alepha";
import { BadRequestError } from "alepha/server";

import {
  ArtifactTarReader,
  type ArtifactTarSink,
} from "./ArtifactTarReader.ts";
import { StackComposeParser } from "./StackComposeParser.ts";

/**
 * A revision bundle, read: the compose text, every path it carries, and the
 * bytes Lore stores and the estate pulls.
 */
export interface StackBundle {
  compose: string;
  files: string[];
  bytes: Uint8Array;
  sha256: string;
}

/**
 * Reads what a revision upload carries.
 *
 * A bundle is a gzip or zstd tar holding a compose file at its root and the
 * files it references, read through {@link ArtifactTarReader}, which already
 * refuses path escapes, symlinks and decompression bombs. A bare compose file
 * is accepted too, the Umami case with nothing beside it, and wrapped into a
 * one-file tar.gz, so every revision is stored and pulled the same way.
 */
export class StackBundleReader {
  protected readonly tar = $inject(ArtifactTarReader);

  /**
   * The upload cap, matching Bay's own bundle cap.
   */
  public static readonly MAX_BYTES = 16 * 1024 * 1024;

  public async read(bytes: Uint8Array): Promise<StackBundle> {
    if (bytes.length > StackBundleReader.MAX_BYTES) {
      throw new BadRequestError(
        "A stack bundle is at most 16 MiB: configuration, not data",
      );
    }
    if (!this.isArchive(bytes)) {
      let compose: string;
      try {
        compose = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new BadRequestError(
          "Upload a compose file or a gzip or zstd tar bundle holding one",
        );
      }
      const wrapped = await this.wrap("compose.yml", bytes);
      return {
        compose,
        files: ["compose.yml"],
        bytes: wrapped,
        sha256: await this.digest(wrapped),
      };
    }

    const found = new Map<string, Uint8Array>();
    const sink: ArtifactTarSink = {
      mkdir: async () => undefined,
      writeFile: async (path: string, body: Uint8Array) => {
        found.set(path.replace(/^\/bundle\//, ""), body);
      },
    };
    await this.tar.extract(bytes, sink, "/bundle");
    const name = StackComposeParser.COMPOSE_NAMES.find((n) => found.has(n));
    if (!name) {
      throw new BadRequestError(
        `The bundle carries no compose file at its root (${StackComposeParser.COMPOSE_NAMES.join(", ")})`,
      );
    }
    const compose = new TextDecoder().decode(found.get(name));
    return {
      compose,
      files: [...found.keys()].sort(),
      bytes,
      sha256: await this.digest(bytes),
    };
  }

  protected isArchive(bytes: Uint8Array): boolean {
    const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const zstd =
      bytes[0] === 0x28 &&
      bytes[1] === 0xb5 &&
      bytes[2] === 0x2f &&
      bytes[3] === 0xfd;
    return gzip || zstd;
  }

  /**
   * One file in a ustar archive, gzipped.
   */
  protected async wrap(name: string, body: Uint8Array): Promise<Uint8Array> {
    const header = new Uint8Array(512);
    const put = (offset: number, text: string) =>
      header.set(new TextEncoder().encode(text), offset);
    put(0, name);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, `${body.length.toString(8).padStart(11, "0")}\0`);
    put(136, "00000000000\0");
    put(148, "        ");
    put(156, "0");
    put(257, "ustar\0");
    put(263, "00");
    let sum = 0;
    for (const byte of header) {
      sum += byte;
    }
    put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    const padded = Math.ceil(body.length / 512) * 512;
    const tar = new Uint8Array(512 + padded + 1024);
    tar.set(header, 0);
    tar.set(body, 512);
    const stream = new Blob([tar as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  protected async digest(bytes: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
