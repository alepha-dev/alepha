import type { Readable as NodeStream } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

/**
 * What the static server needs to know about one file, read once at boot.
 */
export interface StaticFileStat {
  /**
   * Size in bytes, the first half of the ETag.
   */
  size: number;

  /**
   * Last modification: the second half of the ETag, and the `last-modified`
   * header.
   */
  mtime: Date;
}

/**
 * Where the static server reads its files from.
 *
 * Every path is a URL path relative to the served root, starting with `/` and
 * using `/` whatever the platform: `/style.css`, `/assets/app.js`. The disk
 * (`DiskStaticFileSource`) is the default; a compiled binary reads the files
 * it carries inside itself instead. The request handler is written once
 * against this interface, so ETag, 304 and precompressed variants behave the
 * same whatever the source.
 */
export interface StaticFileSource {
  /**
   * Every file to serve, precompressed `.br` and `.gz` siblings included.
   */
  list(): Promise<string[]>;

  /**
   * Size and modification time of one listed file.
   */
  stat(path: string): Promise<StaticFileStat>;

  /**
   * Whether a file exists: how the server finds a file's precompressed
   * siblings.
   */
  has(path: string): Promise<boolean>;

  /**
   * Open a file for reading, or `undefined` when it is gone (listed at boot,
   * removed since), which the server answers with a 404.
   */
  open(path: string): Promise<NodeStream | NodeWebStream | undefined>;
}
