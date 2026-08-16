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
 * Web-standard implementation of FileSystemProvider for Cloudflare Workers and other edge runtimes.
 *
 * Uses only Web APIs (ReadableStream, TextEncoder, etc.) — no Node.js-specific APIs.
 * Provides working `createFile` with proper streaming support.
 * Filesystem operations (rm, cp, stat, etc.) are not available in edge runtimes and will throw.
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
  protected dateTime = $inject(DateTimeProvider);

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

  /**
   * Join, but restart from the last absolute segment — `node:path`'s `resolve`
   * semantics, minus the cwd anchoring, since workerd has no cwd to anchor to.
   */
  public resolve(...paths: string[]): string {
    const parts = paths.filter((part) => part.length > 0);
    const lastAbsolute = parts.findLastIndex((part) => part.startsWith("/"));
    return lastAbsolute === -1
      ? this.join(...parts)
      : this.join(...parts.slice(lastAbsolute));
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
      lastModified: this.dateTime.nowMillis(),
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
      lastModified: this.dateTime.nowMillis(),
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

  protected createFileFromResponse(
    response: Response,
    options: { type?: string; name?: string } = {},
  ): FileLike {
    if (!response.body) {
      throw new AlephaError("Response has no body stream");
    }

    const sizeHeader = response.headers.get("content-length");
    const parsedSize = sizeHeader
      ? Number.parseInt(sizeHeader, 10)
      : Number.NaN;
    const size = Number.isFinite(parsedSize) ? parsedSize : 0;

    const name =
      options.name ??
      this.detector.getFilenameFromContentDisposition(
        response.headers.get("content-disposition"),
      ) ??
      "file";

    const type =
      options.type ?? response.headers.get("content-type") ?? undefined;

    // A Response body reads exactly once. Memoise the consumed bytes so
    // text() after arrayBuffer() (or either one twice) works instead of
    // throwing "Body already read" — same contract as the stream variant.
    let buffer: ArrayBuffer | null = null;
    const consume = async (): Promise<ArrayBuffer> => {
      buffer ??= await response.arrayBuffer();
      return buffer;
    };

    return {
      name,
      type: type ?? this.detector.getContentType(name),
      size,
      lastModified: this.dateTime.nowMillis(),
      stream: () =>
        buffer ? this.streamFromArrayBuffer(buffer) : response.body!,
      arrayBuffer: consume,
      text: async () => this.decoder.decode(await consume()),
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
      lastModified: this.dateTime.nowMillis(),
      // Once buffered, serve fresh streams from the copy instead of
      // handing back the drained source.
      stream: () => (buffer ? this.streamFromArrayBuffer(buffer) : source),
      arrayBuffer: consumeStream,
      text: async () => this.decoder.decode(await consumeStream()),
    };
  }

  /**
   * A fresh single-chunk ReadableStream over already-buffered bytes.
   */
  protected streamFromArrayBuffer(buffer: ArrayBuffer): ReadableStream {
    const bytes = new Uint8Array(buffer);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
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

  public async stat(_path: string): Promise<FileStat> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: stat() is not available in edge runtimes.",
    );
  }

  public async readFile(_path: string): Promise<Buffer> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: readFile() is not available in edge runtimes.",
    );
  }

  public async readFileStream(_path: string): Promise<StreamLike> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: readFileStream() is not available in edge runtimes.",
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

  public async writeJsonFile(_path: string, _value: unknown): Promise<void> {
    throw new AlephaError(
      "WorkerdFileSystemProvider: writeJsonFile() is not available in edge runtimes.",
    );
  }
}
