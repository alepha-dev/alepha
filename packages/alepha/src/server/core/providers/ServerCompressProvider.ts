import { pipeline, Readable, type Transform } from "node:stream";
import { ReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import * as zlib from "node:zlib";

import { $atom, $hook, $inject, $store, Alepha, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import type { ServerResponse } from "alepha/server";

const gzip = promisify(zlib.gzip);
const createGzip = zlib.createGzip;
const brotli = promisify(zlib.brotliCompress);
const createBrotliCompress = zlib.createBrotliCompress;
const zstd = zlib.zstdCompress ? promisify(zlib.zstdCompress) : undefined;
const createZstdCompress = zstd ? zlib.createZstdCompress : undefined;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Compression configuration atom.
 */
export const compressOptions = $atom({
  name: "alepha.server.compress.options",
  schema: z.object({
    disabled: z
      .boolean()
      .describe("Disable response compression entirely.")
      .optional(),
    allowedContentTypes: z
      .array(z.string())
      .describe("Content types eligible for compression."),
  }),
  default: {
    allowedContentTypes: [
      "application/json",
      "text/html",
      "application/javascript",
      "text/plain",
      "text/css",
    ],
  },
  serverOnly: true,
});

export type CompressOptions = Infer<typeof compressOptions.schema>;

declare module "alepha" {
  interface State {
    [compressOptions.key]: CompressOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class ServerCompressProvider {
  static compressors: Record<
    string,
    | {
        compress: (...args: any[]) => Promise<Buffer>;
        stream: (options?: any) => Transform;
      }
    | undefined
  > = {
    gzip: {
      compress: gzip,
      stream: createGzip,
    },
    br: {
      compress: brotli,
      stream: createBrotliCompress,
    },
    zstd:
      zstd && createZstdCompress
        ? {
            compress: zstd,
            stream: createZstdCompress,
          }
        : undefined,
  };

  protected readonly alepha = $inject(Alepha);
  protected readonly options = $store(compressOptions);
  protected readonly log = $logger();

  public readonly onResponse = $hook({
    on: "server:onResponse",
    handler: async ({ request, response }) => {
      if (this.options.disabled) {
        return;
      }

      // In serverless (Cloudflare Workers), skip compression entirely:
      // Cloudflare's edge network automatically compresses responses
      if (this.alepha.isServerless()) {
        return;
      }

      // skip if already compressed
      if (response.headers["content-encoding"]) {
        return;
      }

      const acceptEncoding = request.headers["accept-encoding"]; // skip if no accept-encoding header
      if (!acceptEncoding) {
        return;
      }

      // skip if not json or html (for now)
      if (!this.isAllowedContentType(response.headers["content-type"])) {
        return;
      }

      for (const encoding of ["zstd", "br", "gzip"] as const) {
        if (
          acceptEncoding.includes(encoding) &&
          ServerCompressProvider.compressors[encoding]
        ) {
          await this.compress(encoding, response);
          return;
        }
      }
    },
  });

  protected isAllowedContentType(contentType: string | undefined): boolean {
    if (!contentType) {
      return false;
    }

    const lowerContentType = contentType.toLowerCase();

    return !!this.options.allowedContentTypes.find((it) =>
      lowerContentType.includes(it),
    );
  }

  protected async compress(
    encoding: keyof typeof ServerCompressProvider.compressors,
    response: ServerResponse,
  ): Promise<void> {
    const body = response.body; // can be string or Buffer or ArrayBuffer or Readable

    const compressor = ServerCompressProvider.compressors[encoding];
    if (!compressor) {
      return;
    }

    const params = this.getParams(encoding);

    if (
      typeof body === "string" ||
      Buffer.isBuffer(body) ||
      body instanceof ArrayBuffer
    ) {
      const compressed = await compressor.compress(body, {
        params,
      });
      this.setHeaders(response, encoding);
      response.headers["content-length"] = compressed.length.toString();
      response.body = compressed;
      return;
    }

    if (typeof body === "object" && body instanceof Readable) {
      this.setHeaders(response, encoding);
      // pipeline, not pipe: a failing source must tear the compressor down
      // too, otherwise the response never ends and the client hangs.
      response.body = pipeline(body, compressor.stream({ params }), (error) => {
        if (error) {
          this.log.warn("Compressed response stream failed", error);
        }
      });
      return;
    }

    if (typeof body === "object" && body instanceof ReadableStream) {
      this.setHeaders(response, encoding);
      // For streaming responses, use flush mode to avoid buffering
      response.body = this.createFlushingCompressStream(
        body,
        compressor.stream,
        encoding,
        params,
      );
    }
  }

  /**
   * Create a compressed stream that flushes after each chunk.
   * This is essential for streaming SSR - ensures each chunk is sent immediately.
   */
  protected createFlushingCompressStream(
    input: ReadableStream,
    createCompressor: (options?: any) => Transform,
    encoding: string,
    params: Record<number, any>,
  ): ReadableStream<Uint8Array> {
    const compressor = createCompressor({
      params,
      flush:
        encoding === "br"
          ? zlib.constants.BROTLI_OPERATION_FLUSH
          : zlib.constants.Z_SYNC_FLUSH,
    });
    const reader = Readable.fromWeb(input);

    // `settled` gates every controller call: once the consumer has gone away
    // (cancel) or the stream has ended, touching the controller throws — and
    // it used to throw from inside a 'data' listener, where nothing could
    // catch it.
    let settled = false;

    const teardown = () => {
      if (settled) {
        return;
      }
      settled = true;
      reader.destroy();
      compressor.destroy();
    };

    return new ReadableStream<Uint8Array>({
      start(controller) {
        compressor.on("data", (chunk: Buffer) => {
          if (settled) {
            return;
          }
          try {
            controller.enqueue(new Uint8Array(chunk));
          } catch {
            // Consumer cancelled mid-stream.
            teardown();
            return;
          }
          // Backpressure: stop pulling from the source while the consumer is
          // behind. Without this a slow client plus a large SSR stream
          // buffered without bound. `pull` resumes us.
          if ((controller.desiredSize ?? 1) <= 0) {
            reader.pause();
          }
        });

        compressor.on("end", () => {
          if (settled) {
            return;
          }
          settled = true;
          controller.close();
        });

        compressor.on("error", (err) => {
          if (settled) {
            return;
          }
          settled = true;
          controller.error(err);
        });

        reader.on("data", (chunk: Buffer) => {
          if (settled) {
            return;
          }
          compressor.write(chunk);
          // Force flush after each chunk for streaming
          // Cast to any because flush() exists on zlib streams but not in Transform type
          const zlibStream = compressor as any;
          if (encoding === "gzip") {
            zlibStream.flush(zlib.constants.Z_SYNC_FLUSH);
          } else if (encoding === "br") {
            zlibStream.flush(zlib.constants.BROTLI_OPERATION_FLUSH);
          } else if (encoding === "zstd") {
            zlibStream.flush();
          }
        });

        reader.on("end", () => {
          if (!settled) {
            compressor.end();
          }
        });

        reader.on("error", (err) => {
          if (settled) {
            return;
          }
          settled = true;
          controller.error(err);
        });
      },
      pull() {
        reader.resume();
      },
      cancel() {
        teardown();
      },
    });
  }

  protected getParams(
    encoding: keyof typeof ServerCompressProvider.compressors,
  ): Record<number, any> {
    if (encoding === "zstd") {
      return {
        [zlib.constants.ZSTD_c_compressionLevel]: 3, // default compression level for zstd
      };
    }
    if (encoding === "br") {
      return {};
    }
    if (encoding === "gzip") {
      return {};
    }
    return {};
  }

  protected setHeaders(
    response: ServerResponse,
    encoding: keyof typeof ServerCompressProvider.compressors,
  ): void {
    // Append — CORS may already have added `Origin`, and overwriting it lets a
    // shared cache serve one origin's response to another.
    const current = response.headers.vary;
    const parts = (typeof current === "string" ? current.split(",") : [])
      .map((v) => v.trim())
      .filter(Boolean);

    if (!parts.some((v) => v.toLowerCase() === "accept-encoding")) {
      parts.push("accept-encoding");
    }

    response.headers.vary = parts.join(", ");
    response.headers["content-encoding"] = encoding;
  }
}
