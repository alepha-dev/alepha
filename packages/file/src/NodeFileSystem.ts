import {
  copyFile,
  cp as fsCp,
  mkdir as fsMkdir,
  rm as fsRm,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { FileLike } from "@alepha/core";
import type {
  CpOptions,
  CreateFileOptions,
  FileSystem,
  LsOptions,
  MkdirOptions,
  RmOptions,
} from "./FileSystem.ts";
import {
  createFileFromBuffer,
  createFileFromStream,
  createFileFromUrl,
  createFileFromWebFile,
} from "./helpers/createFile.ts";
import { detectFileType } from "./helpers/detectFileType.ts";
import { getContentType } from "./helpers/getContentType.ts";

/**
 * Node.js implementation of FileSystem interface.
 *
 * @example
 * ```typescript
 * const fs = new NodeFileSystem();
 *
 * // Create from URL
 * const file1 = fs.createFile({ url: "file:///path/to/file.png" });
 *
 * // Create from Buffer
 * const file2 = fs.createFile({ buffer: Buffer.from("hello"), name: "hello.txt" });
 *
 * // Create from text
 * const file3 = fs.createFile({ text: "Hello, world!", name: "greeting.txt" });
 *
 * // File operations
 * await fs.mkdir("/tmp/mydir", { recursive: true });
 * await fs.cp("/src/file.txt", "/dest/file.txt");
 * await fs.mv("/old/path.txt", "/new/path.txt");
 * const files = await fs.ls("/tmp");
 * await fs.rm("/tmp/file.txt");
 * ```
 */
export class NodeFileSystem implements FileSystem {
  /**
   * Creates a FileLike object from various sources.
   *
   * @param options - Options for creating the file
   * @returns A FileLike object
   *
   * @example
   * ```typescript
   * const fs = new NodeFileSystem();
   *
   * // From URL
   * const file1 = fs.createFile({ url: "https://example.com/image.png" });
   *
   * // From Buffer
   * const file2 = fs.createFile({
   *   buffer: Buffer.from("hello"),
   *   name: "hello.txt",
   *   type: "text/plain"
   * });
   *
   * // From text
   * const file3 = fs.createFile({ text: "Hello!", name: "greeting.txt" });
   *
   * // From stream with detection
   * const stream = createReadStream("/path/to/file.png");
   * const file4 = fs.createFile({ stream, name: "image.png" });
   * ```
   */
  createFile(options: CreateFileOptions): FileLike {
    // Handle URL
    if ("url" in options) {
      return createFileFromUrl(options.url, {
        type: options.type,
        name: options.name,
      });
    }

    // Handle Web File
    if ("file" in options) {
      return createFileFromWebFile(options.file, {
        type: options.type,
        name: options.name,
        size: options.size,
      });
    }

    // Handle Buffer
    if ("buffer" in options) {
      return createFileFromBuffer(options.buffer, {
        type: options.type,
        name: options.name,
      });
    }

    // Handle ArrayBuffer
    if ("arrayBuffer" in options) {
      return createFileFromBuffer(Buffer.from(options.arrayBuffer), {
        type: options.type,
        name: options.name,
      });
    }

    // Handle text
    if ("text" in options) {
      return createFileFromBuffer(Buffer.from(options.text, "utf-8"), {
        type: options.type || "text/plain",
        name: options.name || "file.txt",
      });
    }

    // Handle stream
    if ("stream" in options) {
      return createFileFromStream(options.stream, {
        type: options.type,
        name: options.name,
        size: options.size,
      });
    }

    throw new Error("Invalid createFile options: no valid source provided");
  }

  /**
   * Detects the file type by checking magic bytes in a stream.
   *
   * @param stream - The readable stream to check
   * @param filename - The filename (used to get the extension)
   * @returns File type information including MIME type, extension, and verification status
   *
   * @example
   * ```typescript
   * const fs = new NodeFileSystem();
   * const stream = createReadStream('image.png');
   * const result = await fs.detectFileType(stream, 'image.png');
   * console.log(result.mimeType); // 'image/png'
   * console.log(result.verified); // true if magic bytes match
   * ```
   */
  async detectFileType(stream: Readable, filename: string) {
    return detectFileType(stream, filename);
  }

  /**
   * Gets the content type (MIME type) based on a filename.
   *
   * @param filename - The filename to check
   * @returns The MIME type
   *
   * @example
   * ```typescript
   * const fs = new NodeFileSystem();
   * const mimeType = fs.getContentType("image.png"); // "image/png"
   * ```
   */
  getContentType(filename: string): string {
    return getContentType(filename);
  }

  /**
   * Removes a file or directory.
   *
   * @param path - The path to remove
   * @param options - Remove options
   *
   * @example
   * ```typescript
   * const fs = new NodeFileSystem();
   *
   * // Remove a file
   * await fs.rm("/tmp/file.txt");
   *
   * // Remove a directory recursively
   * await fs.rm("/tmp/mydir", { recursive: true });
   *
   * // Remove with force (no error if doesn't exist)
   * await fs.rm("/tmp/maybe-exists.txt", { force: true });
   * ```
   */
  async rm(path: string, options?: RmOptions): Promise<void> {
    await fsRm(path, options);
  }

  /**
   * Copies a file or directory.
   *
   * @param src - Source path
   * @param dest - Destination path
   * @param options - Copy options
   *
   * @example
   * ```typescript
   * const fs = new NodeFileSystem();
   *
   * // Copy a file
   * await fs.cp("/src/file.txt", "/dest/file.txt");
   *
   * // Copy a directory recursively
   * await fs.cp("/src/dir", "/dest/dir", { recursive: true });
   *
   * // Copy with force (overwrite existing)
   * await fs.cp("/src/file.txt", "/dest/file.txt", { force: true });
   * ```
   */
  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    // Check if source is a directory
    const srcStat = await stat(src);

    if (srcStat.isDirectory()) {
      if (!options?.recursive) {
        throw new Error(
          `Cannot copy directory without recursive option: ${src}`,
        );
      }
      // Use Node.js cp function for recursive directory copy
      await fsCp(src, dest, {
        recursive: true,
        force: options?.force ?? false,
      });
    } else {
      // For files, use copyFile
      await copyFile(src, dest);
    }
  }

  /**
   * Moves/renames a file or directory.
   *
   * @param src - Source path
   * @param dest - Destination path
   *
   * @example
   * ```typescript
   * const fs = new NodeFileSystem();
   *
   * // Move/rename a file
   * await fs.mv("/old/path.txt", "/new/path.txt");
   *
   * // Move a directory
   * await fs.mv("/old/dir", "/new/dir");
   * ```
   */
  async mv(src: string, dest: string): Promise<void> {
    await rename(src, dest);
  }

  /**
   * Creates a directory.
   *
   * @param path - The directory path to create
   * @param options - Mkdir options
   *
   * @example
   * ```typescript
   * const fs = new NodeFileSystem();
   *
   * // Create a directory
   * await fs.mkdir("/tmp/mydir");
   *
   * // Create nested directories
   * await fs.mkdir("/tmp/path/to/dir", { recursive: true });
   *
   * // Create with specific permissions
   * await fs.mkdir("/tmp/mydir", { mode: 0o755 });
   * ```
   */
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await fsMkdir(path, options);
  }

  /**
   * Lists files in a directory.
   *
   * @param path - The directory path to list
   * @param options - List options
   * @returns Array of filenames
   *
   * @example
   * ```typescript
   * const fs = new NodeFileSystem();
   *
   * // List files in a directory
   * const files = await fs.ls("/tmp");
   * console.log(files); // ["file1.txt", "file2.txt", "subdir"]
   *
   * // List with hidden files
   * const allFiles = await fs.ls("/tmp", { hidden: true });
   *
   * // List recursively
   * const allFilesRecursive = await fs.ls("/tmp", { recursive: true });
   * ```
   */
  async ls(path: string, options?: LsOptions): Promise<string[]> {
    const entries = await readdir(path);

    // Filter out hidden files if not requested
    const filteredEntries = options?.hidden
      ? entries
      : entries.filter((e) => !e.startsWith("."));

    // If recursive, get all nested files
    if (options?.recursive) {
      const allFiles: string[] = [];

      for (const entry of filteredEntries) {
        const fullPath = join(path, entry);
        const entryStat = await stat(fullPath);

        if (entryStat.isDirectory()) {
          // Add directory entry
          allFiles.push(entry);
          // Recursively get files from subdirectory
          const subFiles = await this.ls(fullPath, options);
          allFiles.push(...subFiles.map((f) => join(entry, f)));
        } else {
          allFiles.push(entry);
        }
      }

      return allFiles;
    }

    return filteredEntries;
  }
}
