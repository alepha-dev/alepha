import type { Readable } from "node:stream";
import type { FileLike, StreamLike } from "@alepha/core";
import type { FileTypeResult } from "./helpers/detectFileType.js";

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
  | CreateFileFromBufferOptions
  | CreateFileFromStreamOptions
  | CreateFileFromTextOptions
  | CreateFileFromWebFileOptions
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
   * If true, copy directories recursively
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
   */
  recursive?: boolean;
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
export abstract class FileSystem {
  /**
   * Creates a FileLike object from various sources.
   *
   * @param options - Options for creating the file
   * @returns A FileLike object
   */
  abstract createFile(options: CreateFileOptions): FileLike;

  /**
   * Detects the file type by checking magic bytes in a stream.
   *
   * @param stream - The readable stream to check
   * @param filename - The filename (used to get the extension)
   * @returns File type information including MIME type, extension, and verification status
   */
  abstract detectFileType(
    stream: Readable,
    filename: string,
  ): Promise<FileTypeResult>;

  /**
   * Gets the content type (MIME type) based on a filename.
   *
   * @param filename - The filename to check
   * @returns The MIME type
   */
  abstract getContentType(filename: string): string;

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
}
