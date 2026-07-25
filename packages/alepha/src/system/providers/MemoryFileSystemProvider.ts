import { basename as nodeBasename, join as nodeJoin } from "node:path";
import { $inject, AlephaError, type FileLike, Json } from "alepha";
import type {
  CpOptions,
  CreateFileOptions,
  FileSystemProvider,
  LsOptions,
  MkdirOptions,
  RmOptions,
} from "./FileSystemProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export interface MemoryFileSystemProviderOptions {
  /**
   * Error to throw on mkdir operations (for testing error handling)
   */
  mkdirError?: Error | null;
  /**
   * Error to throw on writeFile operations (for testing error handling)
   */
  writeFileError?: Error | null;
  /**
   * Error to throw on readFile operations (for testing error handling)
   */
  readFileError?: Error | null;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * In-memory implementation of FileSystemProvider for testing.
 *
 * This provider stores all files and directories in memory, making it ideal for
 * unit tests that need to verify file operations without touching the real file system.
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

  /**
   * In-memory storage for files (path -> content)
   */
  public files = new Map<string, Buffer>();

  /**
   * In-memory storage for directories
   */
  public directories = new Set<string>();

  /**
   * Track mkdir calls for test assertions
   */
  public mkdirCalls: Array<{ path: string; options?: MkdirOptions }> = [];

  /**
   * Track writeFile calls for test assertions
   */
  public writeFileCalls: Array<{ path: string; data: string }> = [];

  /**
   * Track readFile calls for test assertions
   */
  public readFileCalls: Array<string> = [];

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

  constructor(options: MemoryFileSystemProviderOptions = {}) {
    this.mkdirError = options.mkdirError ?? null;
    this.writeFileError = options.writeFileError ?? null;
    this.readFileError = options.readFileError ?? null;
  }

  /**
   * Join path segments using forward slashes.
   * Uses Node's path.join for proper normalization (handles .. and .)
   */
  public join(...paths: string[]): string {
    this.joinCalls.push(paths);
    return nodeJoin(...paths);
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
   * file was written beneath it — `writeFile` does not register parents.
   */
  protected isExistingDirectory(normalizedPath: string): boolean {
    if (normalizedPath === "" || normalizedPath === "/") {
      return true;
    }

    for (const dirPath of this.directories) {
      const dir = this.normalizePath(dirPath);
      if (dir === normalizedPath || dir.startsWith(`${normalizedPath}/`)) {
        return true;
      }
    }

    for (const filePath of this.files.keys()) {
      if (this.normalizePath(filePath).startsWith(`${normalizedPath}/`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create a FileLike object from various sources.
   */
  public createFile(options: CreateFileOptions): FileLike {
    if ("path" in options) {
      const filePath = options.path;
      const buffer = this.files.get(filePath);
      if (buffer === undefined) {
        throw new AlephaError(
          `ENOENT: no such file or directory, open '${filePath}'`,
        );
      }
      return {
        name: options.name ?? nodeBasename(filePath),
        type: options.type ?? "application/octet-stream",
        size: buffer.byteLength,
        lastModified: Date.now(),
        stream: () => {
          throw new AlephaError(
            "Stream not implemented in MemoryFileSystemProvider",
          );
        },
        arrayBuffer: async (): Promise<ArrayBuffer> =>
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer,
        text: async () => buffer.toString("utf-8"),
      };
    }

    if ("buffer" in options) {
      const buffer = options.buffer;
      return {
        name: options.name ?? "file",
        type: options.type ?? "application/octet-stream",
        size: buffer.byteLength,
        lastModified: Date.now(),
        stream: () => {
          throw new AlephaError(
            "Stream not implemented in MemoryFileSystemProvider",
          );
        },
        arrayBuffer: async (): Promise<ArrayBuffer> =>
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer,
        text: async () => buffer.toString("utf-8"),
      };
    }

    if ("text" in options) {
      const buffer = Buffer.from(options.text, "utf-8");
      return {
        name: options.name ?? "file.txt",
        type: options.type ?? "text/plain",
        size: buffer.byteLength,
        lastModified: Date.now(),
        stream: () => {
          throw new AlephaError(
            "Stream not implemented in MemoryFileSystemProvider",
          );
        },
        arrayBuffer: async (): Promise<ArrayBuffer> =>
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer,
        text: async () => options.text,
      };
    }

    throw new AlephaError(
      "MemoryFileSystemProvider.createFile: unsupported options. Only buffer and text are supported.",
    );
  }

  /**
   * Remove a file or directory from memory.
   */
  public async rm(path: string, options?: RmOptions): Promise<void> {
    this.rmCalls.push({ path, options });

    const exists = this.files.has(path) || this.directories.has(path);

    if (!exists && !options?.force) {
      throw new AlephaError(`ENOENT: no such file or directory, rm '${path}'`);
    }

    if (this.directories.has(path)) {
      if (options?.recursive) {
        // Remove directory and all contents
        this.directories.delete(path);
        for (const filePath of this.files.keys()) {
          if (filePath.startsWith(`${path}/`)) {
            this.files.delete(filePath);
          }
        }
        for (const dirPath of this.directories) {
          if (dirPath.startsWith(`${path}/`)) {
            this.directories.delete(dirPath);
          }
        }
      } else {
        throw new AlephaError(
          `EISDIR: illegal operation on a directory, rm '${path}'`,
        );
      }
    } else {
      this.files.delete(path);
    }
  }

  /**
   * Copy a file or directory in memory.
   */
  public async cp(
    src: string,
    dest: string,
    options?: CpOptions,
  ): Promise<void> {
    if (this.directories.has(src)) {
      this.directories.add(dest);
      for (const [filePath, content] of this.files) {
        if (filePath.startsWith(`${src}/`)) {
          const newPath = filePath.replace(src, dest);
          this.files.set(newPath, Buffer.from(content));
        }
      }
    } else if (this.files.has(src)) {
      const content = this.files.get(src)!;
      this.files.set(dest, Buffer.from(content));
    } else {
      throw new AlephaError(`ENOENT: no such file or directory, cp '${src}'`);
    }
  }

  /**
   * Move/rename a file or directory in memory.
   */
  public async mv(src: string, dest: string): Promise<void> {
    if (this.directories.has(src)) {
      // Move directory and contents
      this.directories.delete(src);
      this.directories.add(dest);
      for (const [filePath, content] of this.files) {
        if (filePath.startsWith(`${src}/`)) {
          const newPath = filePath.replace(src, dest);
          this.files.delete(filePath);
          this.files.set(newPath, content);
        }
      }
    } else if (this.files.has(src)) {
      const content = this.files.get(src)!;
      this.files.delete(src);
      this.files.set(dest, content);
    } else {
      throw new AlephaError(`ENOENT: no such file or directory, mv '${src}'`);
    }
  }

  /**
   * Create a directory in memory.
   */
  public async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    this.mkdirCalls.push({ path, options });

    if (this.mkdirError) {
      throw this.mkdirError;
    }

    const normalizedPath = this.normalizePath(path);

    if (this.directories.has(normalizedPath) && !options?.recursive) {
      throw new AlephaError(`EEXIST: file already exists, mkdir '${path}'`);
    }

    this.directories.add(normalizedPath);

    // If recursive, create parent directories
    if (options?.recursive) {
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
      const normalizedFilePath = this.normalizePath(filePath);
      if (normalizedFilePath.startsWith(`${normalizedPath}/`)) {
        const relativePath = normalizedFilePath.slice(
          normalizedPath.length + 1,
        );
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
      const normalizedDirPath = this.normalizePath(dirPath);
      if (
        normalizedDirPath.startsWith(`${normalizedPath}/`) &&
        normalizedDirPath !== normalizedPath
      ) {
        const relativePath = normalizedDirPath.slice(normalizedPath.length + 1);
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
   */
  public async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  /**
   * Read a file from memory.
   */
  public async readFile(path: string): Promise<Buffer> {
    this.readFileCalls.push(path);

    if (this.readFileError) {
      throw this.readFileError;
    }

    const content = this.files.get(path);
    if (!content) {
      throw new AlephaError(
        `ENOENT: no such file or directory, open '${path}'`,
      );
    }
    return content;
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
   * Write a file to memory.
   */
  public async writeFile(
    path: string,
    data: Uint8Array | Buffer | string | FileLike,
  ): Promise<void> {
    const dataStr =
      typeof data === "string"
        ? data
        : data instanceof Buffer || data instanceof Uint8Array
          ? data.toString("utf-8")
          : await data.text();

    this.writeFileCalls.push({ path, data: dataStr });

    if (this.writeFileError) {
      throw this.writeFileError;
    }

    const buffer =
      typeof data === "string"
        ? Buffer.from(data, "utf-8")
        : data instanceof Buffer
          ? data
          : data instanceof Uint8Array
            ? Buffer.from(data)
            : Buffer.from(await data.text(), "utf-8");

    this.files.set(path, buffer);
  }

  /**
   * Reset all in-memory state (useful between tests).
   */
  public reset(): void {
    this.files.clear();
    this.directories.clear();
    this.mkdirCalls = [];
    this.writeFileCalls = [];
    this.readFileCalls = [];
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
   * Check if a file was read during the test.
   *
   * @example
   * ```typescript
   * expect(fs.wasRead("/project/package.json")).toBe(true);
   * ```
   */
  public wasRead(path: string): boolean {
    return this.readFileCalls.includes(path);
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
    return this.files.get(path)?.toString("utf-8");
  }
}
