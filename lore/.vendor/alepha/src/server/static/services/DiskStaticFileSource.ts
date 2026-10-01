import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Readable as NodeStream } from "node:stream";

import type {
  StaticFileSource,
  StaticFileStat,
} from "../interfaces/StaticFileSource.ts";

/**
 * The default source: a directory on disk, walked once at boot.
 *
 * Built per static server, one per served root, which is why it is a plain
 * class and not a DI service.
 */
export class DiskStaticFileSource implements StaticFileSource {
  protected readonly root: string;
  protected readonly ignoreDotFiles: boolean;

  /**
   * @param root Absolute path of the directory to serve.
   * @param ignoreDotFiles Skip `.env` and every other dot file (the default).
   */
  constructor(root: string, ignoreDotFiles = true) {
    this.root = root;
    this.ignoreDotFiles = ignoreDotFiles;
  }

  public async list(): Promise<string[]> {
    const files = await this.walk(this.root);
    return files.map((file) =>
      file.slice(this.root.length).replace(/\\/g, "/"),
    );
  }

  public async stat(path: string): Promise<StaticFileStat> {
    const { size, mtime } = await stat(this.toFilePath(path));
    return { size, mtime };
  }

  public async has(path: string): Promise<boolean> {
    return access(this.toFilePath(path))
      .then(() => true)
      .catch(() => false);
  }

  public async open(path: string): Promise<NodeStream | undefined> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(this.toFilePath(path));
      stream.on("open", () => {
        resolve(stream);
      });
      stream.on("error", (err: NodeJS.ErrnoException) => {
        // Metadata is captured once at boot, so a file deleted afterwards
        // still routes here, and a raw stream error surfaced as a 500.
        // A missing file is a 404.
        if (err?.code === "ENOENT") {
          resolve(undefined);
          return;
        }
        reject(err);
      });
    });
  }

  protected toFilePath(path: string): string {
    return join(this.root, path.replace(/\//g, sep));
  }

  protected async walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });

    const files = await Promise.all(
      entries.map(async (dirent) => {
        // skip .env & other dot files
        if (this.ignoreDotFiles && dirent.name.startsWith(".")) {
          return [];
        }

        const fullPath = join(dir, dirent.name);
        return dirent.isDirectory() ? this.walk(fullPath) : fullPath;
      }),
    );

    return files.flat();
  }
}
