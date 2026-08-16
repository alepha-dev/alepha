import { constants, createReadStream } from "node:fs";
import {
  access,
  copyFile,
  cp as fsCp,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rm as fsRm,
  stat as fsStat,
  writeFile as fsWriteFile,
  readdir,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import {
  $inject,
  AlephaError,
  type FileLike,
  isFileLike,
  Json,
  type StreamLike,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileDetector } from "../services/FileDetector.ts";
import type {
  CpOptions,
  CreateFileOptions,
  FileStat,
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
 * // Create from a path on disk
 * const file1 = fs.createFile({ path: "/path/to/file.png" });
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
 * const files = await fs.ls("/tmp");
 * await fs.rm("/tmp/file.txt");
 * ```
 */
export class NodeFileSystemProvider implements FileSystemProvider {
  protected detector = $inject(FileDetector);
  protected json = $inject(Json);
  protected dateTime = $inject(DateTimeProvider);

  public join(...paths: string[]): string {
    return join(...paths);
  }

  public resolve(...paths: string[]): string {
    return resolve(...paths);
  }

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
   * // From a path on disk
   * const file1 = fs.createFile({ path: "./assets/image.png" });
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
    if ("path" in options) {
      return this.createFileFromPath(options.path, {
        type: options.type,
        name: options.name,
      });
    }

    if ("response" in options) {
      if (!options.response.body) {
        throw new AlephaError("Response has no body stream");
      }
      const res = options.response;
      // guess size from content-length header if available
      const sizeHeader = res.headers.get("content-length");
      const parsedSize = sizeHeader
        ? Number.parseInt(sizeHeader, 10)
        : Number.NaN;
      const size = Number.isFinite(parsedSize) ? parsedSize : undefined;
      // guess name from content-disposition header if available
      const name =
        options.name ??
        this.detector.getFilenameFromContentDisposition(
          res.headers.get("content-disposition"),
        );
      // guess type from content-type header if available
      const type = options.type || res.headers.get("content-type") || undefined;
      return this.createFileFromStream(options.response.body, {
        type,
        name,
        size,
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
   * By default an existing destination is overwritten — the common case is a
   * build task re-running over its previous output. With `force: false` an
   * existing destination is an ERROR, never a silent skip: a copy that
   * quietly did nothing is how stale artifacts ship.
   *
   * @param src - Source path
   * @param dest - Destination path
   * @param options - Copy options
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   *
   * // Copy a file (overwrites an existing destination)
   * await fs.cp("/src/file.txt", "/dest/file.txt");
   *
   * // Copy a directory (recursive by default)
   * await fs.cp("/src/dir", "/dest/dir");
   *
   * // Refuse to overwrite
   * await fs.cp("/src/file.txt", "/dest/file.txt", { force: false });
   * ```
   */
  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const force = options?.force ?? true;
    const srcStat = await fsStat(src);

    if (srcStat.isDirectory()) {
      await fsCp(src, dest, {
        recursive: options?.recursive ?? true,
        force,
        errorOnExist: !force,
      });
    } else {
      await copyFile(src, dest, force ? 0 : constants.COPYFILE_EXCL);
    }
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
  async mkdir(path: string, options: MkdirOptions = {}): Promise<void> {
    const p = fsMkdir(path, {
      recursive: options.recursive ?? true,
      mode: options.mode,
    });

    if (options.force === false) {
      await p;
      return;
    }

    // `force` only ever meant "an existing directory is fine". Swallowing
    // EVERY error made EACCES, ENOSPC and EROFS vanish, so the failure
    // surfaced far from its cause on a later write. `recursive: true` already
    // makes EEXIST a no-op, so this rethrows anything else.
    await p.catch((error: NodeJS.ErrnoException) => {
      if (error?.code === "EEXIST") {
        return;
      }
      throw error;
    });
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
        const entryStat = await fsStat(fullPath);

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
   * Returns metadata about a file or directory.
   *
   * @param path - The path to inspect
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   * const { size, mtimeMs, isDirectory } = await fs.stat("/tmp/file.txt");
   * ```
   */
  async stat(path: string): Promise<FileStat> {
    const stats = await fsStat(path);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
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
   * Opens a readable stream over the content of a file.
   *
   * @param path - The file path to stream
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   * const stream = await fs.readFileStream("/tmp/big-file.bin");
   * ```
   */
  async readFileStream(path: string): Promise<StreamLike> {
    // `createReadStream` is lazy — it would only error at first read. Stat
    // upfront so a missing path (or a directory) fails HERE, where the
    // caller named it, not deep inside whatever consumes the stream.
    const stats = await fsStat(path);
    if (stats.isDirectory()) {
      throw new AlephaError(
        `EISDIR: illegal operation on a directory, read '${path}'`,
      );
    }
    return createReadStream(path);
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
    data: Uint8Array | Buffer | string | FileLike,
  ): Promise<void> {
    if (isFileLike(data)) {
      await fsWriteFile(path, Readable.from(data.stream()));
      return;
    }
    await fsWriteFile(path, data);
  }

  /**
   * Reads the content of a file as a string.
   *
   * @param path - The file path to read
   * @returns The file content as a string
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   * const content = await fs.readTextFile("/tmp/file.txt");
   * ```
   */
  async readTextFile(path: string): Promise<string> {
    const buffer = await this.readFile(path);
    return buffer.toString("utf-8");
  }

  /**
   * Reads the content of a file as JSON.
   *
   * @param path - The file path to read
   * @returns The parsed JSON content
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   * const config = await fs.readJsonFile<{ name: string }>("/tmp/config.json");
   * ```
   */
  async readJsonFile<T = unknown>(path: string): Promise<T> {
    const text = await this.readTextFile(path);
    return this.json.parse(text) as T;
  }

  /**
   * Serialises a value as pretty-printed JSON and writes it to a file.
   *
   * @param path - The file path to write to
   * @param value - The value to serialise
   *
   * @example
   * ```typescript
   * const fs = alepha.inject(NodeFileSystemProvider);
   * await fs.writeJsonFile("/tmp/config.json", { name: "alepha" });
   * ```
   */
  async writeJsonFile(path: string, value: unknown): Promise<void> {
    await this.writeFile(path, this.json.stringify(value, null, 2));
  }

  /**
   * Creates a FileLike object over a file on disk.
   *
   * The content is read lazily: `stream()` opens a fresh read stream per
   * call, `arrayBuffer()`/`text()` load (and memoise) the file. `size` is 0
   * until loaded — use {@link stat} when the byte count matters upfront.
   *
   * @protected
   */
  protected createFileFromPath(
    path: string,
    options: {
      type?: string;
      name?: string;
    } = {},
  ): FileLike {
    const filepath = resolve(path);
    const name = options.name || basename(filepath);
    let buffer: Buffer | null = null;
    const load = async (): Promise<Buffer> => {
      buffer ??= await fsReadFile(filepath);
      return buffer;
    };

    return {
      name,
      type: options.type ?? this.detector.getContentType(name),
      size: 0, // Unknown size until loaded
      lastModified: this.dateTime.nowMillis(),
      stream: () => createReadStream(filepath),
      arrayBuffer: async () => this.bufferToArrayBuffer(await load()),
      text: async () => (await load()).toString("utf-8"),
      filepath,
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
      lastModified: this.dateTime.nowMillis(),
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
  ): FileLike {
    let buffer: Buffer | null = null;

    return {
      name: options.name ?? "file",
      type:
        options.type ?? this.detector.getContentType(options.name ?? "file"),
      size: options.size ?? 0,
      lastModified: this.dateTime.nowMillis(),
      // The source itself can only be consumed once. But once text() or
      // arrayBuffer() has buffered it, stream() can serve fresh streams
      // forever — returning the drained source instead was a silent
      // empty-payload bug.
      stream: () => (buffer ? Readable.from(buffer) : source),
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
