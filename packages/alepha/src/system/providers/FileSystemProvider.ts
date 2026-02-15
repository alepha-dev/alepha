import type { FileLike, StreamLike } from "alepha";

/**
 * Options for creating a file from a URL
 */
export interface CreateFileFromUrlOptions {
  /**
   * The URL to load the file from (file://, http://, or https://)
   */
  url: string;
  /**
   * The MIME type of the file (optional, will be detected from filename if not provided)
   */
  type?: string;
  /**
   * The name of the file (optional, will be extracted from URL if not provided)
   */
  name?: string;
}

/**
 * Options for creating a file from a path (URL with file:// scheme)
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
   * The name of the file (optional, will be extracted from URL if not provided)
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
 * Options for creating a file from a Web File object
 */
export interface CreateFileFromWebFileOptions {
  /**
   * The Web File object
   */
  file: File;
  /**
   * Override the MIME type (optional, uses file.type if not provided)
   */
  type?: string;
  /**
   * Override the name (optional, uses file.name if not provided)
   */
  name?: string;
  /**
   * Override the size (optional, uses file.size if not provided)
   */
  size?: number;
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
  | CreateFileFromUrlOptions
  | CreateFileFromPathOptions
  | CreateFileFromBufferOptions
  | CreateFileFromStreamOptions
  | CreateFileFromTextOptions
  | CreateFileFromWebFileOptions
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
   * If true, overwrite existing destination
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
   * Moves/renames a file or directory.
   *
   * @param src - Source path
   * @param dest - Destination path
   */
  abstract mv(src: string, dest: string): Promise<void>;

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
   * Reads the content of a file.
   *
   * @param path - The file path to read
   * @returns The file content as a Buffer
   */
  abstract readFile(path: string): Promise<Buffer>;

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
}
