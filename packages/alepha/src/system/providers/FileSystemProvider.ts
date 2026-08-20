import type { FileLike, StreamLike } from "alepha";

/**
 * Options for creating a file from a path on the provider's storage.
 */
export interface CreateFileFromPathOptions {
  /**
   * The path to the file on the local filesystem
   */
  path: string;
  /**
   * The MIME type of the file (optional, will be detected from filename if not provided)
   */
  type?: string;
  /**
   * The name of the file (optional, defaults to the path's basename)
   */
  name?: string;
}

/**
 * Options for creating a file from a Buffer
 */
export interface CreateFileFromBufferOptions {
  /**
   * The Buffer containing the file data
   */
  buffer: Buffer;
  /**
   * The MIME type of the file (optional, will be detected from name if not provided)
   */
  type?: string;
  /**
   * The name of the file (required for proper content type detection)
   */
  name?: string;
}

/**
 * Options for creating a file from a stream
 */
export interface CreateFileFromStreamOptions {
  /**
   * The readable stream containing the file data
   */
  stream: StreamLike;
  /**
   * The MIME type of the file (optional, will be detected from name if not provided)
   */
  type?: string;
  /**
   * The name of the file (required for proper content type detection)
   */
  name?: string;
  /**
   * The size of the file in bytes (optional)
   */
  size?: number;
}

/**
 * Options for creating a file from text content
 */
export interface CreateFileFromTextOptions {
  /**
   * The text content to create the file from
   */
  text: string;
  /**
   * The MIME type of the file (default: text/plain)
   */
  type?: string;
  /**
   * The name of the file (default: "file.txt")
   */
  name?: string;
}

export interface CreateFileFromResponseOptions {
  /**
   * The Response object containing the file data
   */
  response: Response;
  /**
   * Override the name (optional, uses filename from Content-Disposition header if not provided)
   */
  name?: string;
  /**
   * Override the MIME type (optional, uses file.type if not provided)
   */
  type?: string;
}

/**
 * Options for creating a file from an ArrayBuffer
 */
export interface CreateFileFromArrayBufferOptions {
  /**
   * The ArrayBuffer containing the file data
   */
  arrayBuffer: ArrayBuffer;
  /**
   * The MIME type of the file (optional, will be detected from name if not provided)
   */
  type?: string;
  /**
   * The name of the file (required for proper content type detection)
   */
  name?: string;
}

/**
 * Union type for all createFile options
 */
export type CreateFileOptions =
  | CreateFileFromPathOptions
  | CreateFileFromBufferOptions
  | CreateFileFromStreamOptions
  | CreateFileFromTextOptions
  | CreateFileFromResponseOptions
  | CreateFileFromArrayBufferOptions;

/**
 * Options for rm (remove) operation
 */
export interface RmOptions {
  /**
   * If true, removes directories and their contents recursively
   */
  recursive?: boolean;
  /**
   * If true, no error will be thrown if the path does not exist
   */
  force?: boolean;
}

/**
 * Options for cp (copy) operation
 */
export interface CpOptions {
  /**
   * Copy directories recursively.
   *
   * @default true
   */
  recursive?: boolean;
  /**
   * Overwrite an existing destination. When false, copying onto an existing
   * destination throws instead of silently skipping it.
   *
   * @default true
   */
  force?: boolean;
}

/**
 * Options for mkdir operation
 */
export interface MkdirOptions {
  /**
   * If true, creates parent directories as needed
   *
   * @default true
   */
  recursive?: boolean;
  /**
   * If true, does not throw an error if the directory already exists
   *
   * @default true
   */
  force?: boolean;
  /**
   * File mode (permission and sticky bits)
   */
  mode?: number;
}

/**
 * Options for ls (list) operation
 */
export interface LsOptions {
  /**
   * If true, list contents of directories recursively
   */
  recursive?: boolean;
  /**
   * If true, include hidden files (starting with .)
   */
  hidden?: boolean;
}

/**
 * Metadata about a file or directory, as returned by {@link FileSystemProvider.stat}.
 */
export interface FileStat {
  /**
   * Size in bytes. 0 for directories on backends that do not track it.
   */
  size: number;
  /**
   * Last modification time in milliseconds since epoch.
   */
  mtimeMs: number;
  /**
   * True when the path is a directory.
   */
  isDirectory: boolean;
  /**
   * True when the path is a regular file.
   */
  isFile: boolean;
}

/**
 * FileSystem interface providing utilities for working with files.
 */
export abstract class FileSystemProvider {
  /**
   * Joins multiple path segments into a single path.
   *
   * @param paths - The path segments to join
   * @returns The joined path
   */
  abstract join(...paths: string[]): string;

  /**
   * Joins path segments, but lets a later absolute segment win.
   *
   * The difference from {@link join} is the whole point: `join("/app", "/tmp/x")`
   * is `/app/tmp/x`, while `resolve("/app", "/tmp/x")` is `/tmp/x`. Anywhere a
   * user-supplied path is anchored to a project root — a `--out` flag, a config
   * value — `join` silently reparents an absolute path under the root and the
   * write fails on a directory nobody asked for.
   *
   * @param paths - The path segments to resolve, left to right
   * @returns The resolved path
   */
  abstract resolve(...paths: string[]): string;

  /**
   * Creates a FileLike object from various sources.
   *
   * @param options - Options for creating the file
   * @returns A FileLike object
   */
  abstract createFile(options: CreateFileOptions): FileLike;

  /**
   * Removes a file or directory.
   *
   * @param path - The path to remove
   * @param options - Remove options
   */
  abstract rm(path: string, options?: RmOptions): Promise<void>;

  /**
   * Copies a file or directory.
   *
   * @param src - Source path
   * @param dest - Destination path
   * @param options - Copy options
   */
  abstract cp(src: string, dest: string, options?: CpOptions): Promise<void>;

  /**
   * Creates a directory.
   *
   * @param path - The directory path to create
   * @param options - Mkdir options
   */
  abstract mkdir(path: string, options?: MkdirOptions): Promise<void>;

  /**
   * Lists files in a directory.
   *
   * @param path - The directory path to list
   * @param options - List options
   * @returns Array of filenames
   */
  abstract ls(path: string, options?: LsOptions): Promise<string[]>;

  /**
   * Checks if a file or directory exists.
   *
   * @param path - The path to check
   * @returns True if the path exists, false otherwise
   */
  abstract exists(path: string): Promise<boolean>;

  /**
   * Returns metadata about a file or directory.
   *
   * Throws when the path does not exist.
   *
   * @param path - The path to inspect
   */
  abstract stat(path: string): Promise<FileStat>;

  /**
   * Reads the content of a file.
   *
   * @param path - The file path to read
   * @returns The file content as a Buffer
   */
  abstract readFile(path: string): Promise<Buffer>;

  /**
   * Opens a readable stream over the content of a file.
   *
   * Unlike {@link readFile}, the content is never fully materialised in
   * memory — this is the right call for handing large files to an upload
   * or a compression step. Throws when the path does not exist.
   *
   * @param path - The file path to stream
   */
  abstract readFileStream(path: string): Promise<StreamLike>;

  /**
   * Writes data to a file.
   *
   * @param path - The file path to write to
   * @param data - The data to write (Buffer or string)
   */
  abstract writeFile(
    path: string,
    data: Uint8Array | Buffer | string | FileLike,
  ): Promise<void>;

  /**
   * Appends data to a file, creating it when it does not exist.
   *
   * The distinction from {@link writeFile} is cost, not convenience: an
   * append-only log grows by one line at a time, and re-serialising the whole
   * file on every line turns a cheap write into one proportional to everything
   * written so far. Callers that keep such a file are expected to compact it
   * themselves; nothing here bounds its size.
   *
   * @param path - The file path to append to
   * @param data - The data to append (Buffer or string)
   */
  abstract appendFile(
    path: string,
    data: Uint8Array | Buffer | string,
  ): Promise<void>;

  /**
   * Reads the content of a file as a string.
   *
   * @param path - The file path to read
   * @returns The file content as a string
   */
  abstract readTextFile(path: string): Promise<string>;

  /**
   * Reads the content of a file as JSON.
   *
   * @param path - The file path to read
   * @returns The parsed JSON content
   */
  abstract readJsonFile<T = unknown>(path: string): Promise<T>;

  /**
   * Serialises a value as pretty-printed JSON and writes it to a file.
   *
   * The counterpart of {@link readJsonFile}. Two-space indentation, because
   * these files end up in git diffs and human hands.
   *
   * @param path - The file path to write to
   * @param value - The value to serialise
   */
  abstract writeJsonFile(path: string, value: unknown): Promise<void>;
}
