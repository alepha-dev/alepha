import {
  $inject,
  AlephaError,
  type FileLike,
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

// ---------------------------------------------------------------------------------------------------------------------

/**
 * In-memory implementation of FileSystemProvider for testing.
 *
 * This provider stores all files and directories in memory, making it ideal for
 * unit tests that need to verify file operations without touching the real file system.
 *
 * One deliberate looseness versus the node provider: `writeFile` succeeds
 * without its parent directories existing (and registers them implicitly),
 * so tests can seed fixtures in one call. Everything else follows the
 * contract pinned by `fileSystemContract.spec.ts`.
 *
 * @example
 * ```typescript
 * // In tests, substitute the real FileSystemProvider with MemoryFileSystemProvider
 * const alepha = Alepha.create().with({
 *   provide: FileSystemProvider,
 *   use: MemoryFileSystemProvider,
 * });
 *
 * // Run code that uses FileSystemProvider
 * const service = alepha.inject(MyService);
 * await service.saveFile("test.txt", "Hello World");
 *
 * // Verify the file was written
 * const memoryFs = alepha.inject(MemoryFileSystemProvider);
 * expect(memoryFs.files.get("test.txt")?.toString()).toBe("Hello World");
 * ```
 */
export class MemoryFileSystemProvider implements FileSystemProvider {
  protected json = $inject(Json);
  protected dateTime = $inject(DateTimeProvider);
  protected detector = $inject(FileDetector);

  /**
   * In-memory storage for files (path -> content)
   */
  public files = new Map<string, Buffer>();

  /**
   * In-memory storage for directories
   */
  public directories = new Set<string>();

  /**
   * Modification times (path -> epoch millis) for {@link stat}.
   */
  public mtimes = new Map<string, number>();

  /**
   * Track mkdir calls for test assertions
   */
  public mkdirCalls: Array<{ path: string; options?: MkdirOptions }> = [];

  /**
   * Track writeFile calls for test assertions
   */
  public writeFileCalls: Array<{ path: string; data: string }> = [];

  /**
   * Track rm calls for test assertions
   */
  public rmCalls: Array<{ path: string; options?: RmOptions }> = [];

  /**
   * Track join calls for test assertions
   */
  public joinCalls: Array<string[]> = [];

  /**
   * Error to throw on mkdir (for testing error handling)
   */
  public mkdirError: Error | null = null;

  /**
   * Error to throw on writeFile (for testing error handling)
   */
  public writeFileError: Error | null = null;

  /**
   * Error to throw on readFile (for testing error handling)
   */
  public readFileError: Error | null = null;

  /**
   * Join path segments using forward slashes.
   * Uses Node's path.join for proper normalization (handles .. and .)
   */
  public join(...paths: string[]): string {
    this.joinCalls.push(paths);
    return this.posixJoin(...paths);
  }

  /**
   * Join, but restart from the last absolute segment — `node:path`'s `resolve`
   * semantics, minus the cwd anchoring `resolve` applies to a fully relative
   * result. There is no cwd here, and this provider also backs the browser and
   * workerd builds where there is no process to ask.
   */
  public resolve(...paths: string[]): string {
    const parts = paths.filter((part) => part.length > 0);
    const lastAbsolute = parts.findLastIndex((part) => part.startsWith("/"));
    return this.posixJoin(
      ...(lastAbsolute === -1 ? parts : parts.slice(lastAbsolute)),
    );
  }

  /**
   * Join and normalize path segments, resolving `.` and `..`.
   *
   * A local posix implementation rather than `node:path`: this provider is the
   * portable one — it backs the browser and workerd builds, where importing
   * `node:path` resolves to an empty stub and every call would throw.
   */
  protected posixJoin(...paths: string[]): string {
    const joined = paths.filter((part) => part.length > 0).join("/");
    if (joined === "") {
      return ".";
    }
    const isAbsolute = joined.startsWith("/");
    const trailingSlash = joined.endsWith("/");
    const segments: string[] = [];
    for (const segment of joined.split("/")) {
      if (segment === "" || segment === ".") {
        continue;
      }
      if (segment === "..") {
        if (segments.length > 0 && segments.at(-1) !== "..") {
          segments.pop();
        } else if (!isAbsolute) {
          segments.push("..");
        }
        continue;
      }
      segments.push(segment);
    }
    let result = segments.join("/");
    if (isAbsolute) {
      result = `/${result}`;
    } else if (result === "") {
      result = ".";
    }
    if (trailingSlash && !result.endsWith("/")) {
      result += "/";
    }
    return result;
  }

  /**
   * Trailing path segment, mirroring `path.basename`.
   */
  protected posixBasename(path: string): string {
    const normalized = this.normalizePath(path).replace(/\/+$/, "");
    if (normalized === "" || normalized === "/") {
      return "";
    }
    return normalized.slice(normalized.lastIndexOf("/") + 1);
  }

  /**
   * Parent directory, mirroring `path.dirname`.
   */
  protected posixDirname(path: string): string {
    const normalized = this.normalizePath(path).replace(/\/+$/, "");
    const index = normalized.lastIndexOf("/");
    if (index < 0) {
      return ".";
    }
    if (index === 0) {
      return "/";
    }
    return normalized.slice(0, index);
  }

  /**
   * Normalize path separators to forward slashes for consistent internal storage.
   * This ensures Windows paths work correctly in the in-memory file system.
   */
  protected normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
  }

  /**
   * A path counts as a directory when it was created explicitly or when a
   * file or directory was registered beneath it.
   */
  protected isExistingDirectory(normalizedPath: string): boolean {
    if (normalizedPath === "" || normalizedPath === "/") {
      return true;
    }

    for (const dirPath of this.directories) {
      if (
        dirPath === normalizedPath ||
        dirPath.startsWith(`${normalizedPath}/`)
      ) {
        return true;
      }
    }

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(`${normalizedPath}/`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Registers `path` and every parent as directories.
   */
  protected registerDirectoryTree(normalizedPath: string): void {
    const parts = normalizedPath.split("/").filter(Boolean);
    // Keep the leading slash: rebuilding `/app/src` as `app/src` registered
    // a key nothing else looks up, so `exists("/app/src")` said no — while
    // the node provider reports every parent of a `mkdir -p`.
    let current = normalizedPath.startsWith("/") ? "" : undefined;
    for (const part of parts) {
      current = current === undefined ? part : `${current}/${part}`;
      this.directories.add(current);
    }
  }

  /**
   * Create a FileLike object from various sources.
   *
   * Supports the full option union — as the DEFAULT provider in tests, any
   * source the node provider accepts has to work here too, or production
   * code paths become untestable by substitution.
   */
  public createFile(options: CreateFileOptions): FileLike {
    if ("path" in options) {
      const filePath = this.normalizePath(options.path);
      const buffer = this.files.get(filePath);
      if (buffer === undefined) {
        throw new AlephaError(
          `ENOENT: no such file or directory, open '${options.path}'`,
        );
      }
      return this.fileLikeFromBuffer(buffer, {
        name: options.name ?? this.posixBasename(filePath),
        type: options.type,
      });
    }

    if ("buffer" in options) {
      return this.fileLikeFromBuffer(options.buffer, {
        name: options.name ?? "file",
        type: options.type,
      });
    }

    if ("arrayBuffer" in options) {
      return this.fileLikeFromBuffer(Buffer.from(options.arrayBuffer), {
        name: options.name ?? "file",
        type: options.type,
      });
    }

    if ("text" in options) {
      return this.fileLikeFromBuffer(Buffer.from(options.text, "utf-8"), {
        name: options.name ?? "file.txt",
        type: options.type ?? "text/plain",
      });
    }

    if ("response" in options) {
      const res = options.response;
      if (!res.body) {
        throw new AlephaError("Response has no body stream");
      }
      const name =
        options.name ??
        this.detector.getFilenameFromContentDisposition(
          res.headers.get("content-disposition"),
        ) ??
        "file";
      return this.fileLikeFromStream(res.body, {
        name,
        type: options.type ?? res.headers.get("content-type") ?? undefined,
      });
    }

    if ("stream" in options) {
      return this.fileLikeFromStream(options.stream, {
        name: options.name ?? "file",
        type: options.type,
        size: options.size,
      });
    }

    throw new AlephaError(
      "MemoryFileSystemProvider.createFile: unsupported options.",
    );
  }

  /**
   * Remove a file or directory from memory.
   */
  public async rm(path: string, options?: RmOptions): Promise<void> {
    this.rmCalls.push({ path, options });

    const normalized = this.normalizePath(path);
    const isFile = this.files.has(normalized);
    const isDirectory = !isFile && this.isExistingDirectory(normalized);

    if (!isFile && !isDirectory) {
      if (options?.force) {
        return;
      }
      throw new AlephaError(`ENOENT: no such file or directory, rm '${path}'`);
    }

    if (isDirectory) {
      if (!options?.recursive) {
        throw new AlephaError(
          `EISDIR: illegal operation on a directory, rm '${path}'`,
        );
      }
      this.directories.delete(normalized);
      this.mtimes.delete(normalized);
      for (const filePath of this.files.keys()) {
        if (filePath.startsWith(`${normalized}/`)) {
          this.files.delete(filePath);
          this.mtimes.delete(filePath);
        }
      }
      for (const dirPath of this.directories) {
        if (dirPath.startsWith(`${normalized}/`)) {
          this.directories.delete(dirPath);
          this.mtimes.delete(dirPath);
        }
      }
      return;
    }

    this.files.delete(normalized);
    this.mtimes.delete(normalized);
  }

  /**
   * Copy a file or directory in memory.
   *
   * Same force semantics as the node provider: overwrite by default, and an
   * existing destination is an ERROR (not a silent skip) with `force: false`.
   */
  public async cp(
    src: string,
    dest: string,
    options?: CpOptions,
  ): Promise<void> {
    const force = options?.force ?? true;
    const from = this.normalizePath(src);
    const to = this.normalizePath(dest);

    if (this.isExistingDirectory(from) && !this.files.has(from)) {
      if (options?.recursive === false) {
        throw new AlephaError(
          `EISDIR: illegal operation on a directory, cp '${src}'`,
        );
      }
      this.registerDirectoryTree(to);
      for (const dirPath of [...this.directories]) {
        if (dirPath.startsWith(`${from}/`)) {
          this.directories.add(`${to}/${dirPath.slice(from.length + 1)}`);
        }
      }
      for (const [filePath, content] of [...this.files]) {
        if (filePath.startsWith(`${from}/`)) {
          const newPath = `${to}/${filePath.slice(from.length + 1)}`;
          if (!force && this.files.has(newPath)) {
            throw new AlephaError(
              `EEXIST: file already exists, cp '${newPath}'`,
            );
          }
          this.files.set(newPath, Buffer.from(content));
          this.mtimes.set(newPath, this.dateTime.nowMillis());
        }
      }
      return;
    }

    const content = this.files.get(from);
    if (!content) {
      throw new AlephaError(`ENOENT: no such file or directory, cp '${src}'`);
    }
    if (!force && this.files.has(to)) {
      throw new AlephaError(`EEXIST: file already exists, cp '${dest}'`);
    }
    this.files.set(to, Buffer.from(content));
    this.mtimes.set(to, this.dateTime.nowMillis());
  }

  /**
   * Create a directory in memory.
   *
   * Follows the interface defaults: recursive AND force both default to
   * true, exactly like the node provider — a duplicate mkdir is a no-op
   * unless the caller explicitly opts into strictness.
   */
  public async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    this.mkdirCalls.push({ path, options });

    if (this.mkdirError) {
      throw this.mkdirError;
    }

    const normalized = this.normalizePath(path);
    const recursive = options?.recursive ?? true;
    const force = options?.force ?? true;

    if (recursive) {
      this.registerDirectoryTree(normalized);
      this.mtimes.set(normalized, this.dateTime.nowMillis());
      return;
    }

    if (this.isExistingDirectory(normalized)) {
      if (force) {
        return;
      }
      throw new AlephaError(`EEXIST: file already exists, mkdir '${path}'`);
    }

    const parent = this.normalizePath(this.posixDirname(normalized));
    if (!this.isExistingDirectory(parent)) {
      throw new AlephaError(
        `ENOENT: no such file or directory, mkdir '${path}'`,
      );
    }

    this.directories.add(normalized);
    this.mtimes.set(normalized, this.dateTime.nowMillis());
  }

  /**
   * List files in a directory.
   */
  public async ls(path: string, options?: LsOptions): Promise<string[]> {
    const normalizedPath = this.normalizePath(path).replace(/\/$/, "");
    const entries = new Set<string>();

    // Match the node provider, which is a raw readdir: a directory that does
    // not exist is an error, not an empty listing. Returning `[]` here let
    // callers that would crash in production pass their tests.
    if (!this.isExistingDirectory(normalizedPath)) {
      throw new AlephaError(
        `ENOENT: no such file or directory, scandir '${path}'`,
      );
    }

    // Find files in the directory
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(`${normalizedPath}/`)) {
        const relativePath = filePath.slice(normalizedPath.length + 1);
        const parts = relativePath.split("/");

        if (options?.recursive) {
          entries.add(relativePath);
        } else {
          entries.add(parts[0]);
        }
      }
    }

    // Find subdirectories
    for (const dirPath of this.directories) {
      if (
        dirPath.startsWith(`${normalizedPath}/`) &&
        dirPath !== normalizedPath
      ) {
        const relativePath = dirPath.slice(normalizedPath.length + 1);
        const parts = relativePath.split("/");

        if (options?.recursive) {
          entries.add(relativePath);
        } else if (parts.length === 1) {
          entries.add(parts[0]);
        }
      }
    }

    let result = Array.from(entries);

    // Filter hidden files unless requested
    if (!options?.hidden) {
      result = result.filter((entry) => !entry.startsWith("."));
    }

    return result.sort();
  }

  /**
   * Check if a file or directory exists in memory.
   *
   * Implicit directories count: a parent of any stored file or directory
   * exists, exactly as it would on a real filesystem.
   */
  public async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);
    return this.files.has(normalized) || this.isExistingDirectory(normalized);
  }

  /**
   * Returns metadata about a file or directory.
   */
  public async stat(path: string): Promise<FileStat> {
    const normalized = this.normalizePath(path);
    const content = this.files.get(normalized);

    if (content) {
      return {
        size: content.byteLength,
        mtimeMs: this.mtimes.get(normalized) ?? 0,
        isDirectory: false,
        isFile: true,
      };
    }

    if (this.isExistingDirectory(normalized)) {
      return {
        size: 0,
        mtimeMs: this.mtimes.get(normalized) ?? 0,
        isDirectory: true,
        isFile: false,
      };
    }

    throw new AlephaError(`ENOENT: no such file or directory, stat '${path}'`);
  }

  /**
   * Read a file from memory.
   */
  public async readFile(path: string): Promise<Buffer> {
    if (this.readFileError) {
      throw this.readFileError;
    }

    const content = this.files.get(this.normalizePath(path));
    if (!content) {
      throw new AlephaError(
        `ENOENT: no such file or directory, open '${path}'`,
      );
    }
    return content;
  }

  /**
   * Opens a readable stream over a stored file.
   */
  public async readFileStream(path: string): Promise<StreamLike> {
    const content = await this.readFile(path);
    return this.bufferToStream(content);
  }

  /**
   * Read a file from memory as text.
   */
  public async readTextFile(path: string): Promise<string> {
    const buffer = await this.readFile(path);
    return buffer.toString("utf-8");
  }

  /**
   * Read a file from memory as JSON.
   */
  public async readJsonFile<T = unknown>(path: string): Promise<T> {
    const text = await this.readTextFile(path);
    return this.json.parse(text) as T;
  }

  /**
   * Serialises a value as pretty-printed JSON and writes it to a file.
   */
  public async writeJsonFile(path: string, value: unknown): Promise<void> {
    await this.writeFile(path, this.json.stringify(value, null, 2));
  }

  /**
   * Write a file to memory.
   */
  public async writeFile(
    path: string,
    data: Uint8Array | Buffer | string | FileLike,
  ): Promise<void> {
    // Materialise ONCE — FileLike sources may be single-shot streams, so
    // consuming them twice (once for the assertion log, once for storage)
    // stored an empty payload.
    const buffer =
      typeof data === "string"
        ? Buffer.from(data, "utf-8")
        : data instanceof Buffer
          ? data
          : data instanceof Uint8Array
            ? Buffer.from(data)
            : Buffer.from(await data.arrayBuffer());

    this.writeFileCalls.push({ path, data: buffer.toString("utf-8") });

    if (this.writeFileError) {
      throw this.writeFileError;
    }

    const normalized = this.normalizePath(path);
    this.files.set(normalized, buffer);
    this.mtimes.set(normalized, this.dateTime.nowMillis());
  }

  /**
   * Reset all in-memory state (useful between tests).
   */
  public reset(): void {
    this.files.clear();
    this.directories.clear();
    this.mtimes.clear();
    this.mkdirCalls = [];
    this.writeFileCalls = [];
    this.rmCalls = [];
    this.joinCalls = [];
    this.mkdirError = null;
    this.writeFileError = null;
    this.readFileError = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Test assertion helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a file was written during the test.
   *
   * @example
   * ```typescript
   * expect(fs.wasWritten("/project/tsconfig.json")).toBe(true);
   * ```
   */
  public wasWritten(path: string): boolean {
    return this.writeFileCalls.some((call) => call.path === path);
  }

  /**
   * Check if a file was written with content matching a pattern.
   *
   * @example
   * ```typescript
   * expect(fs.wasWrittenMatching("/project/tsconfig.json", /extends/)).toBe(true);
   * ```
   */
  public wasWrittenMatching(path: string, pattern: RegExp): boolean {
    const call = this.writeFileCalls.find((c) => c.path === path);
    return call ? pattern.test(call.data) : false;
  }

  /**
   * Check if a file was deleted during the test.
   *
   * @example
   * ```typescript
   * expect(fs.wasDeleted("/project/old-file.txt")).toBe(true);
   * ```
   */
  public wasDeleted(path: string): boolean {
    return this.rmCalls.some((call) => call.path === path);
  }

  /**
   * Get the content of a file as a string (convenience method for testing).
   */
  public getFileContent(path: string): string | undefined {
    return this.files.get(this.normalizePath(path))?.toString("utf-8");
  }

  /**
   * Builds a FileLike over an in-memory buffer.
   *
   * Streams come from `Blob` — a fresh, standards-based stream per call on
   * every runtime, with no `node:stream` import that would poison browser
   * bundles.
   *
   * @protected
   */
  protected fileLikeFromBuffer(
    buffer: Buffer,
    options: { name: string; type?: string },
  ): FileLike {
    const bytes = new Uint8Array(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    );
    return {
      name: options.name,
      type: options.type ?? this.detector.getContentType(options.name),
      size: buffer.byteLength,
      lastModified: this.dateTime.nowMillis(),
      stream: () => this.bufferToStream(buffer),
      arrayBuffer: async (): Promise<ArrayBuffer> =>
        bytes.buffer as ArrayBuffer,
      text: async () => buffer.toString("utf-8"),
    };
  }

  /**
   * FileLike over a one-shot stream: the source is consumed (and memoised)
   * on first read, after which every accessor serves from the copy.
   *
   * @protected
   */
  protected fileLikeFromStream(
    source: StreamLike,
    options: { name: string; type?: string; size?: number },
  ): FileLike {
    let buffer: Buffer | null = null;
    const consume = async (): Promise<Buffer> => {
      if (buffer) {
        return buffer;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of source as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
      return buffer;
    };

    return {
      name: options.name,
      type: options.type ?? this.detector.getContentType(options.name),
      size: options.size ?? 0,
      lastModified: this.dateTime.nowMillis(),
      stream: () => (buffer ? this.bufferToStream(buffer) : source),
      arrayBuffer: async () => {
        const b = await consume();
        return b.buffer.slice(
          b.byteOffset,
          b.byteOffset + b.byteLength,
        ) as ArrayBuffer;
      },
      text: async () => (await consume()).toString("utf-8"),
    };
  }

  /**
   * A fresh web ReadableStream over a buffer's bytes.
   *
   * @protected
   */
  protected bufferToStream(buffer: Buffer): StreamLike {
    const bytes = new Uint8Array(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    );
    return new Blob([bytes]).stream();
  }
}
