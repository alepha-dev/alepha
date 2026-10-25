import { gzipSync } from "node:zlib";

import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { load as parseYaml } from "js-yaml";

/**
 * A stack revision bundle, ready to upload.
 */
export interface LoreStackBundle {
  file: File;
  /**
   * Every path the bundle carries, the compose file first.
   */
  paths: string[];
}

/**
 * Packs a stack revision: the compose file plus every file it bind-mounts
 * relative to its own directory, as a gzip tar (#Q2700).
 *
 * A missing referenced file is refused HERE, before anything is uploaded,
 * naming the file: the server would refuse it too, but after an upload.
 * A compose file that mounts nothing is sent as it is, and Lore wraps it.
 * The compose file is always `compose.yml` in the bundle, whatever it is
 * called on disk, since that is a name the estate looks for.
 */
export class LoreStackBundler {
  protected readonly fs = $inject(FileSystemProvider);

  public static readonly MAX_BYTES = 16 * 1024 * 1024;

  /**
   * The names Compose itself looks for, in its order.
   */
  public static readonly DEFAULT_NAMES = [
    "compose.yaml",
    "compose.yml",
    "docker-compose.yaml",
    "docker-compose.yml",
  ];

  /**
   * The compose file in `root`, by the names Compose looks for, if any.
   */
  public async findDefault(root = "/"): Promise<string | undefined> {
    for (const name of LoreStackBundler.DEFAULT_NAMES) {
      if (await this.fs.exists(this.fs.resolve(root, name))) return name;
    }
    return undefined;
  }

  public async bundle(
    composePath: string,
    root = "/",
  ): Promise<LoreStackBundle> {
    const path = this.fs.resolve(root, composePath);
    if (!(await this.fs.exists(path))) {
      throw new AlephaError(`No compose file at ${composePath}.`);
    }
    const text = await this.fs.readTextFile(path);
    const dir = this.fs.resolve(path, "..");
    const references = this.references(text);
    const files = new Map<string, Uint8Array>([
      ["compose.yml", new TextEncoder().encode(text)],
    ]);
    for (const ref of references) {
      const absolute = this.fs.resolve(dir, ref);
      if (!absolute.startsWith(`${dir}/`) && absolute !== dir) {
        throw new AlephaError(
          `${composePath} mounts ${ref}, which is outside its directory: only files beside it can be bundled.`,
        );
      }
      if (!(await this.fs.exists(absolute))) {
        throw new AlephaError(
          `${composePath} mounts ./${ref}, which does not exist. Create it, or remove the mount.`,
        );
      }
      for (const file of await this.collect(absolute)) {
        files.set(file.slice(dir.length + 1), await this.fs.readFile(file));
      }
    }
    const paths = [...files.keys()];
    if (paths.length === 1) {
      return {
        file: new File([text], "compose.yml", {
          type: "application/octet-stream",
        }),
        paths,
      };
    }
    const archive = gzipSync(this.tar(files));
    if (archive.length > LoreStackBundler.MAX_BYTES) {
      throw new AlephaError(
        "The bundle is over 16 MiB. A stack bundle is configuration: keep data out of the files it mounts.",
      );
    }
    return {
      file: new File([archive as BlobPart], "bundle.tar.gz", {
        type: "application/gzip",
      }),
      paths,
    };
  }

  /**
   * The relative bind-mount sources a compose file names, short syntax
   * (`./conf:/etc/x`) and long (`{ type: bind, source: ./conf }`).
   */
  public references(text: string): string[] {
    let doc: unknown;
    try {
      doc = parseYaml(text);
    } catch (error) {
      throw new AlephaError(
        `The compose file is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const services =
      (
        doc as
          | { services?: Record<string, { volumes?: unknown[] }> }
          | undefined
      )?.services ?? {};
    const found = new Set<string>();
    for (const service of Object.values(services)) {
      for (const volume of service?.volumes ?? []) {
        let source: string | undefined;
        if (typeof volume === "string" && volume.includes(":")) {
          source = volume.split(":")[0];
        } else if (volume && typeof volume === "object") {
          const long = volume as { type?: string; source?: string };
          source = long.type === "bind" ? long.source : undefined;
        }
        if (
          source &&
          (source.startsWith("./") ||
            source.startsWith("../") ||
            source === ".")
        ) {
          found.add(source.replace(/^\.\//, ""));
        }
      }
    }
    return [...found];
  }

  protected async collect(path: string): Promise<string[]> {
    const stat = await this.fs.stat(path);
    if (!stat.isDirectory) {
      return [path];
    }
    const out: string[] = [];
    for (const name of await this.fs.ls(path)) {
      out.push(...(await this.collect(this.fs.join(path, name))));
    }
    return out;
  }

  /**
   * A ustar archive of regular files.
   */
  protected tar(files: Map<string, Uint8Array>): Uint8Array {
    const blocks: Uint8Array[] = [];
    for (const [name, body] of files) {
      if (name.length > 100) {
        throw new AlephaError(
          `${name} is a path too long for the bundle (100 characters at most).`,
        );
      }
      const header = new Uint8Array(512);
      const put = (offset: number, value: string) =>
        header.set(new TextEncoder().encode(value), offset);
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
      for (const byte of header) sum += byte;
      put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
      blocks.push(header);
      const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
      padded.set(body);
      blocks.push(padded);
    }
    blocks.push(new Uint8Array(1024));
    const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
    let offset = 0;
    for (const block of blocks) {
      out.set(block, offset);
      offset += block.length;
    }
    return out;
  }
}
