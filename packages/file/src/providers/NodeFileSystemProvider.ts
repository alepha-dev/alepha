import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  cp as fsCp,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rm as fsRm,
  writeFile as fsWriteFile,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import {
  $inject,
  AlephaError,
  type FileLike,
  type StreamLike,
} from "@alepha/core";
import { FileDetector } from "../services/FileDetector.ts";
import type {
  CpOptions,
  CreateFileOptions,
  FileSystemProvider,
  LsOptions,
  MkdirOptions,
  RmOptions,
} from "./FileSystemProvider.ts";

/**
 * Node.js implementation of FileSystem interface.
 *
 * @example
 * ```typescript
 * const fs = alepha.inject(NodeFileSystemProvider);
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
export class NodeFileSystemProvider implements FileSystemProvider {
  protected detector = $inject(FileDetector);
  /**
   * Creates a FileLike object from various sources.
   *
   * @param options - Options for creating the file
   * @returns A FileLike object
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
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
      return this.createFileFromUrl(options.url, {
        type: options.type,
        name: options.name,
      });
    }

    // Handle Web File
    if ("file" in options) {
      return this.createFileFromWebFile(options.file, {
        type: options.type,
        name: options.name,
        size: options.size,
      });
    }

    // Handle Buffer
    if ("buffer" in options) {
      return this.createFileFromBuffer(options.buffer, {
        type: options.type,
        name: options.name,
      });
    }

    // Handle ArrayBuffer
    if ("arrayBuffer" in options) {
      return this.createFileFromBuffer(Buffer.from(options.arrayBuffer), {
        type: options.type,
        name: options.name,
      });
    }

    // Handle text
    if ("text" in options) {
      return this.createFileFromBuffer(Buffer.from(options.text, "utf-8"), {
        type: options.type || "text/plain",
        name: options.name || "file.txt",
      });
    }

    // Handle stream
    if ("stream" in options) {
      return this.createFileFromStream(options.stream, {
        type: options.type,
        name: options.name,
        size: options.size,
      });
    }

    throw new AlephaError(
      "Invalid createFile options: no valid source provided",
    );
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
   * const fs = alepha.inject(NodeFileSystemProvider);
   * const stream = createReadStream('image.png');
   * const result = await fs.detectFileType(stream, 'image.png');
   * console.log(result.mimeType); // 'image/png'
   * console.log(result.verified); // true if magic bytes match
   * ```
   */
  async detectFileType(stream: Readable, filename: string) {
    return this.detector.detectFileType(stream, filename);
  }

  /**
   * Gets the content type (MIME type) based on a filename.
   *
   * @param filename - The filename to check
   * @returns The MIME type
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   * const mimeType = fs.getContentType("image.png"); // "image/png"
   * ```
   */
  getContentType(filename: string): string {
    return this.detector.getContentType(filename);
  }

  /**
   * Removes a file or directory.
   *
   * @param path - The path to remove
   * @param options - Remove options
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
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
   * const fs = alepha.inject(NodeFileSystemProvider);
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
   * const fs = alepha.inject(NodeFileSystemProvider);
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
   * const fs = alepha.inject(NodeFileSystemProvider);
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
   * const fs = alepha.inject(NodeFileSystemProvider);
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

  /**
   * Checks if a file or directory exists.
   *
   * @param path - The path to check
   * @returns True if the path exists, false otherwise
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   *
   * if (await fs.exists("/tmp/file.txt")) {
   *   console.log("File exists");
   * }
   * ```
   */
  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads the content of a file.
   *
   * @param path - The file path to read
   * @returns The file content as a Buffer
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   *
   * const buffer = await fs.readFile("/tmp/file.txt");
   * console.log(buffer.toString("utf-8"));
   * ```
   */
  async readFile(path: string): Promise<Buffer> {
    return await fsReadFile(path);
  }

  /**
   * Writes data to a file.
   *
   * @param path - The file path to write to
   * @param data - The data to write (Buffer or string)
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   *
   * // Write string
   * await fs.writeFile("/tmp/file.txt", "Hello, world!");
   *
   * // Write Buffer
   * await fs.writeFile("/tmp/file.bin", Buffer.from([0x01, 0x02, 0x03]));
   * ```
   */
  async writeFile(
    path: string,
    data: Uint8Array | Buffer | string,
  ): Promise<void> {
    await fsWriteFile(path, data);
  }

  /**
   * Creates a FileLike object from a Web File.
   *
   * @protected
   */
  protected createFileFromWebFile(
    source: File,
    options: {
      type?: string;
      name?: string;
      size?: number;
    } = {},
  ): FileLike {
    const name = options.name ?? source.name;
    return {
      name,
      type: options.type ?? (source.type || this.detector.getContentType(name)),
      size: options.size ?? source.size ?? 0,
      lastModified: source.lastModified || Date.now(),
      stream: () => source.stream(),
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        return await source.arrayBuffer();
      },
      text: async (): Promise<string> => {
        return await source.text();
      },
    };
  }

  /**
   * Creates a FileLike object from a Buffer.
   *
   * @protected
   */
  protected createFileFromBuffer(
    source: Buffer,
    options: {
      type?: string;
      name?: string;
    } = {},
  ): FileLike {
    const name: string = options.name ?? "file";
    return {
      name,
      type: options.type ?? this.detector.getContentType(options.name ?? name),
      size: source.byteLength,
      lastModified: Date.now(),
      stream: (): Readable => Readable.from(source),
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        return this.bufferToArrayBuffer(source);
      },
      text: async (): Promise<string> => {
        return source.toString("utf-8");
      },
    };
  }

  /**
   * Creates a FileLike object from a stream.
   *
   * @protected
   */
  protected createFileFromStream(
    source: StreamLike,
    options: {
      type?: string;
      name?: string;
      size?: number;
    } = {},
  ): FileLike & { _buffer: null | Buffer } {
    let buffer: Buffer | null = null;

    return {
      name: options.name ?? "file",
      type:
        options.type ?? this.detector.getContentType(options.name ?? "file"),
      size: options.size ?? 0,
      lastModified: Date.now(),
      stream: () => source,
      _buffer: null as Buffer | null,
      arrayBuffer: async () => {
        buffer ??= await this.streamToBuffer(source);
        return this.bufferToArrayBuffer(buffer);
      },
      text: async () => {
        buffer ??= await this.streamToBuffer(source);
        return buffer.toString("utf-8");
      },
    };
  }

  /**
   * Creates a FileLike object from a URL.
   *
   * @protected
   */
  protected createFileFromUrl(
    url: string,
    options: {
      type?: string;
      name?: string;
    } = {},
  ): FileLike {
    const parsedUrl = new URL(url);
    const filename =
      options.name || parsedUrl.pathname.split("/").pop() || "file";
    let buffer: Buffer | null = null;

    return {
      name: filename,
      type: options.type ?? this.detector.getContentType(filename),
      size: 0, // Unknown size until loaded
      lastModified: Date.now(),
      stream: () => this.createStreamFromUrl(url),
      arrayBuffer: async () => {
        buffer ??= await this.loadFromUrl(url);
        return this.bufferToArrayBuffer(buffer);
      },
      text: async () => {
        buffer ??= await this.loadFromUrl(url);
        return buffer.toString("utf-8");
      },
      filepath: url,
    };
  }

  /**
   * Gets a streaming response from a URL.
   *
   * @protected
   */
  protected getStreamingResponse(url: string): Readable {
    const stream = new PassThrough();

    fetch(url)
      .then((res) => Readable.fromWeb(res.body as NodeWebStream).pipe(stream))
      .catch((err) => stream.destroy(err));

    return stream;
  }

  /**
   * Loads data from a URL.
   *
   * @protected
   */
  protected async loadFromUrl(url: string): Promise<Buffer> {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol === "file:") {
      // Handle file:// URLs
      const filePath = fileURLToPath(url);
      return await fsReadFile(filePath);
    } else if (
      parsedUrl.protocol === "http:" ||
      parsedUrl.protocol === "https:"
    ) {
      // Handle HTTP/HTTPS URLs
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } else {
      throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
    }
  }

  /**
   * Creates a stream from a URL.
   *
   * @protected
   */
  protected createStreamFromUrl(url: string): Readable {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol === "file:") {
      // For file:// URLs, create a stream that reads the file
      return createReadStream(fileURLToPath(url));
    } else if (
      parsedUrl.protocol === "http:" ||
      parsedUrl.protocol === "https:"
    ) {
      // For HTTP/HTTPS URLs, create a stream that fetches the content
      return this.getStreamingResponse(url);
    } else {
      throw new AlephaError(`Unsupported protocol: ${parsedUrl.protocol}`);
    }
  }

  /**
   * Converts a stream-like object to a Buffer.
   *
   * @protected
   */
  protected async streamToBuffer(streamLike: StreamLike): Promise<Buffer> {
    const stream =
      streamLike instanceof Readable
        ? streamLike
        : Readable.fromWeb(streamLike as NodeWebStream);

    return new Promise<Buffer>((resolve, reject) => {
      const buffer: any[] = [];
      stream.on("data", (chunk) => buffer.push(Buffer.from(chunk)));
      stream.on("end", () => resolve(Buffer.concat(buffer)));
      stream.on("error", (err) =>
        reject(new AlephaError("Error converting stream", { cause: err })),
      );
    });
  }

  /**
   * Converts a Node.js Buffer to an ArrayBuffer.
   *
   * @protected
   */
  protected bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
  }
}
