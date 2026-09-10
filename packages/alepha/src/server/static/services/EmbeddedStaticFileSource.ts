import type { ReadableStream as NodeWebStream } from "node:stream/web";

import { AlephaError } from "alepha";

import type {
  StaticFileSource,
  StaticFileStat,
} from "../interfaces/StaticFileSource.ts";

/**
 * The files a `bun build --compile` binary carries inside itself.
 *
 * `files` maps each URL path to the path Bun gave the embedded copy
 * (`/$bunfs/root/...`), which only `Bun.file()` can read. Every file takes
 * `builtAt` as its modification time, so ETag and Last-Modified stay the same
 * across restarts of one binary and change with every build.
 *
 * The only code in the static server that touches the `Bun` global, which is
 * why it refuses to be built anywhere else.
 */
export class EmbeddedStaticFileSource implements StaticFileSource {
  protected readonly files: Record<string, string>;
  protected readonly mtime: Date;

  /**
   * @param files URL path to embedded path, as the build wrote it.
   * @param builtAt Build time in epoch milliseconds.
   */
  constructor(files: Record<string, string>, builtAt: number) {
    if (typeof Bun === "undefined") {
      throw new AlephaError(
        "Embedded static files can only be read by the Bun binary they were compiled into, and the Bun global is missing here.",
      );
    }
    this.files = files;
    this.mtime = new Date(builtAt);
  }

  public async list(): Promise<string[]> {
    return Object.keys(this.files);
  }

  public async stat(path: string): Promise<StaticFileStat> {
    return { size: Bun.file(this.embeddedPath(path)).size, mtime: this.mtime };
  }

  public async has(path: string): Promise<boolean> {
    return Object.hasOwn(this.files, path);
  }

  public async open(path: string): Promise<NodeWebStream | undefined> {
    if (!Object.hasOwn(this.files, path)) {
      return undefined;
    }
    return Bun.file(this.files[path]).stream() as unknown as NodeWebStream;
  }

  protected embeddedPath(path: string): string {
    if (!Object.hasOwn(this.files, path)) {
      throw new AlephaError(`'${path}' is not embedded in this binary.`);
    }
    return this.files[path];
  }
}
