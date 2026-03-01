import { $inject, AlephaError, type FileLike, Json } from "alepha";
import { FileDetector } from "../services/FileDetector.ts";
import type {
  CpOptions,
  CreateFileOptions,
  FileSystemProvider,
  LsOptions,
  MkdirOptions,
  RmOptions,
} from "./FileSystemProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Web-standard implementation of FileSystemProvider for Cloudflare Workers and other edge runtimes.
 *
 * Uses only Web APIs (ReadableStream, TextEncoder, etc.) — no Node.js-specific APIs.
 * Provides working `createFile` with proper streaming support.
 * Filesystem operations (rm, cp, mv, etc.) are not available in edge runtimes and will throw.
 *
 * @example
 * ```typescript
 * const fs = alepha.inject(WorkerdFileSystemProvider);
 *
 * // Create from text (returns FileLike with web ReadableStream)
 * const file = fs.createFile({ text: "Hello!", name: "greeting.txt" });
 * const stream = file.stream(); // ReadableStream (web standard)
 * ```
 */
export class WorkerdFileSystemProvider implements FileSystemProvider {
  protected detector = $inject(FileDetector);
  protected json = $inject(Json);

  protected encoder = new TextEncoder();
  protected decoder = new TextDecoder();

  public join(...paths: string[]): string {
    const joined = paths.join("/").replace(/\/+/g, "/");
    const parts = joined.split("/");
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        resolved.pop();
      } else if (part !== ".") {
        resolved.push(part);
      }
    }
    return resolved.join("/") || ".";
  }

  public createFile(options: CreateFileOptions): FileLike {
    if ("text" in options) {
      return this.createFileFromText(options.text, {
        type: options.type,
        name: options.name,
      });
    }

    if ("arrayBuffer" in options) {
      return this.createFileFromArrayBuffer(options.arrayBuffer, {
        type: options.type,
        name: options.name,
      });
    }

    if ("buffer" in options) {
      const ab =
        options.buffer instanceof ArrayBuffer
          ? options.buffer
          : options.buffer.buffer.slice(
              options.buffer.byteOffset,
              options.buffer.byteOffset + options.buffer.byteLength,
            );
      return this.createFileFromArrayBuffer(ab as ArrayBuffer, {
        type: options.type,
        name: options.name,
      });
    }

    if ("file" in options) {
      return this.createFileFromWebFile(options.file, {
        type: options.type,
        name: options.name,
        size: options.size,
      });
    }

    if ("response" in options) {
      return this.createFileFromResponse(options.response, {
        type: options.type,
        name: options.name,
      });
    }

    if ("stream" in options) {
      return this.createFileFromStream(options.stream as ReadableStream, {
        type: options.type,
        name: options.name,
        size: options.size,
      });
    }

    if ("url" in options) {
      return this.createFileFromUrl(options.url, {
        type: options.type,
        name: options.name,
      });
    }

    if ("path" in options) {
      throw new AlephaError(
        "WorkerdFileSystemProvider.createFile: 'path' source is not supported in edge runtimes.",
      );
    }

    throw new AlephaError(
      "WorkerdFileSystemProvider.createFile: unsupported options.",
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected createFileFromText(
    text: string,
    options: { type?: string; name?: string } = {},
  ): FileLike {
    const encoded = this.encoder.encode(text);
    const name = options.name ?? "file.txt";
    return {
      name,
      type: options.type ?? this.detector.getContentType(name),
      size: encoded.byteLength,
      lastModified: Date.now(),
      stream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoded);
            controller.close();
          },
        }),
      arrayBuffer: async () =>
        encoded.buffer.slice(
          encoded.byteOffset,
          encoded.byteOffset + encoded.byteLength,
        ) as ArrayBuffer,
      text: async () => text,
    };
  }

  protected createFileFromArrayBuffer(
    source: ArrayBuffer,
    options: { type?: string; name?: string } = {},
  ): FileLike {
    const name = options.name ?? "file";
    const bytes = new Uint8Array(source);
    return {
      name,
      type: options.type ?? this.detector.getContentType(name),
      size: source.byteLength,
      lastModified: Date.now(),
      stream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      arrayBuffer: async () => source,
      text: async () => this.decoder.decode(source),
    };
  }

  protected createFileFromWebFile(
    source: File,
    options: { type?: string; name?: string; size?: number } = {},
  ): FileLike {
    const name = options.name ?? source.name;
    return {
      name,
      type: options.type ?? (source.type || this.detector.getContentType(name)),
      size: options.size ?? source.size ?? 0,
      lastModified: source.lastModified || Date.now(),
      stream: () => source.stream(),
      arrayBuffer: async () => await source.arrayBuffer(),
      text: async () => await source.text(),
    };
  }

  protected createFileFromResponse(
    response: Response,
    options: { type?: string; name?: string } = {},
  ): FileLike {
    if (!response.body) {
      throw new AlephaError("Response has no body stream");
    }

    const sizeHeader = response.headers.get("content-length");
    const size = sizeHeader ? parseInt(sizeHeader, 10) : 0;

    let name = options.name;
    if (!name) {
      const cd = response.headers.get("content-disposition");
      if (cd) {
        const match = cd.match(/filename="?([^"]+)"?/);
        if (match) {
          name = match[1];
        }
      }
    }
    name ??= "file";

    const type =
      options.type ?? response.headers.get("content-type") ?? undefined;

    return {
      name,
      type: type ?? this.detector.getContentType(name),
      size,
      lastModified: Date.now(),
      stream: () => response.body!,
      arrayBuffer: async () => await response.arrayBuffer(),
      text: async () => await response.text(),
    };
  }

  protected createFileFromStream(
    source: ReadableStream,
    options: { type?: string; name?: string; size?: number } = {},
  ): FileLike {
    const name = options.name ?? "file";
    let buffer: ArrayBuffer | null = null;

    const consumeStream = async (): Promise<ArrayBuffer> => {
      if (buffer) return buffer;
      const reader = source.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          chunks.push(result.value);
        }
      }
      const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      buffer = merged.buffer as ArrayBuffer;
      return buffer;
    };

    return {
      name,
      type: options.type ?? this.detector.getContentType(name),
      size: options.size ?? 0,
      lastModified: Date.now(),
      stream: () => source,
      arrayBuffer: consumeStream,
      text: async () => this.decoder.decode(await consumeStream()),
    };
  }

  protected createFileFromUrl(
    url: string,
    options: { type?: string; name?: string } = {},
  ): FileLike {
    const parsedUrl = new URL(url);
    const name = options.name ?? parsedUrl.pathname.split("/").pop() ?? "file";

    return {
      name,
      type: options.type ?? this.detector.getContentType(name),
      size: 0,
      lastModified: Date.now(),
      stream: () => {
        throw new AlephaError(
          "WorkerdFileSystemProvider: streaming from URL is not supported. Use fetch() and createFile({ response }) instead.",
        );
      },
      arrayBuffer: async () => {
        const res = await fetch(url);
        return await res.arrayBuffer();
      },
      text: async () => {
        const res = await fetch(url);
        return await res.text();
      },
    };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Filesystem operations — not available in edge runtimes
  // -------------------------------------------------------------------------------------------------------------------

  public async rm(_path: string, _options?: RmOptions): Promise<void> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: rm() is not available in edge runtimes.",
    );
  }

  public async cp(
    _src: string,
    _dest: string,
    _options?: CpOptions,
  ): Promise<void> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: cp() is not available in edge runtimes.",
    );
  }

  public async mv(_src: string, _dest: string): Promise<void> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: mv() is not available in edge runtimes.",
    );
  }

  public async mkdir(_path: string, _options?: MkdirOptions): Promise<void> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: mkdir() is not available in edge runtimes.",
    );
  }

  public async ls(_path: string, _options?: LsOptions): Promise<string[]> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: ls() is not available in edge runtimes.",
    );
  }

  public async exists(_path: string): Promise<boolean> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: exists() is not available in edge runtimes.",
    );
  }

  public async readFile(_path: string): Promise<Buffer> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: readFile() is not available in edge runtimes.",
    );
  }

  public async writeFile(
    _path: string,
    _data: Uint8Array | Buffer | string | FileLike,
  ): Promise<void> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: writeFile() is not available in edge runtimes.",
    );
  }

  public async readTextFile(_path: string): Promise<string> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: readTextFile() is not available in edge runtimes.",
    );
  }

  public async readJsonFile<T = unknown>(_path: string): Promise<T> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: readJsonFile() is not available in edge runtimes.",
    );
  }
}
