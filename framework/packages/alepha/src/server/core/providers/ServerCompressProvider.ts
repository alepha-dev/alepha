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
    threshold: z
      .integer()
      .describe(
        "Smallest buffered body, in bytes, worth compressing. A stream is always compressed: its size is unknown.",
      )
      .optional(),
  }),
  default: {
    threshold: 1024,
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
        compressSync: (...args: any[]) => Buffer;
        stream: (options?: any) => Transform;
      }
    | undefined
  > = {
    gzip: {
      compress: gzip,
      compressSync: zlib.gzipSync,
      stream: createGzip,
    },
    br: {
      compress: brotli,
      compressSync: zlib.brotliCompressSync,
      stream: createBrotliCompress,
    },
    zstd:
      zstd && createZstdCompress && zlib.zstdCompressSync
        ? {
            compress: zstd,
            compressSync: zlib.zstdCompressSync,
            stream: createZstdCompress,
          }
        : undefined,
  };

  /**
   * The largest buffered body compressed synchronously, in bytes.
   *
   * The asynchronous zlib call costs about twice the CPU of the synchronous
   * one on a small body (a 7 KiB JSON in brotli 4: 75 to 97 µs against 35 to
   * 45 µs, Node and Bun alike), the thread-pool round trip and the per-call
   * stream outweighing the compression itself. The synchronous call blocks
   * the event loop for as long as it computes, about 30 µs at 7 KiB and 165
   * µs at 64 KiB, so a larger body keeps the asynchronous path.
   */
  protected static readonly SYNC_LIMIT = 64 * 1024;

  protected readonly alepha = $inject(Alepha);
  protected readonly options = $store(compressOptions);
  protected readonly log = $logger();

  public readonly onResponse = $hook({
    on: "server:response:after",
    // Not `async`: most responses leave without compression (too small, no
    // `accept-encoding`, not a compressible type), and a hook that returns no
    // promise lets the event finish in the same turn. Only a body actually
    // compressed returns one.
    handler: ({ request, response }) => {
      // Read once: each access of a `$store` field is a store lookup.
      const options = this.options;
      if (options.disabled) {
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
      if (
        !this.isAllowedContentType(response.headers["content-type"], options)
      ) {
        return;
      }

      // A small body is sent as it is. Below about a kilobyte the encoded
      // form saves a few bytes at best (a 27-byte JSON grows under every
      // encoder), while each compression is a round trip through the libuv
      // thread pool: a hello-world `$action` answered 24k req/s with it and
      // 31k without it on the same machine.
      if (this.isBelowThreshold(response.body, options)) {
        return;
      }

      const encoding = this.pickEncoding(acceptEncoding);
      if (encoding) {
        return this.compress(encoding, response);
      }
    },
  });

  /**
   * The encoding to answer with, from an `Accept-Encoding` header, per
   * RFC 9110 section 12.5.3. `undefined` sends the body uncompressed.
   *
   * - Tokens are case-insensitive and whitespace-tolerant; a missing `q` is
   *   1, and a malformed one makes that token unacceptable.
   * - `q=0` refuses an encoding. `*` gives its q to every encoding the header
   *   does not name; an encoding neither named nor covered by `*` is refused.
   * - The highest q wins; a tie goes to the server's order (zstd, br, gzip),
   *   among the compressors this runtime has.
   * - Nothing acceptable, `identity;q=0` included, sends identity rather than
   *   a 406: RFC 9110 allows it, and a 406 on a JSON API is worse than an
   *   ignored preference.
   *
   * It used to pick the first of zstd, br, gzip whose name appeared anywhere
   * in the header, so `br;q=0, gzip` was answered in br.
   */
  protected pickEncoding(
    acceptEncoding: string,
  ): "zstd" | "br" | "gzip" | undefined {
    const named = new Map<string, number>();
    let wildcard: number | undefined;

    for (const part of acceptEncoding.split(",")) {
      const [rawName, ...params] = part.split(";");
      const name = rawName.trim().toLowerCase();
      if (!name) continue;

      let q = 1;
      for (const param of params) {
        const [key, value] = param.split("=").map((it) => it.trim());
        if (key.toLowerCase() !== "q") continue;
        q = /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(value ?? "")
          ? Number(value)
          : 0;
      }

      if (name === "*") {
        wildcard = q;
      } else {
        named.set(name, q);
      }
    }

    let best: { encoding: "zstd" | "br" | "gzip"; q: number } | undefined;
    for (const encoding of ["zstd", "br", "gzip"] as const) {
      if (!ServerCompressProvider.compressors[encoding]) continue;
      const q = named.get(encoding) ?? wildcard ?? 0;
      if (q > 0 && (!best || q > best.q)) {
        best = { encoding, q };
      }
    }
    return best?.encoding;
  }

  /**
   * Whether a buffered body is too small to be worth compressing. A stream is
   * never below the threshold, since its size is not known in advance.
   */
  protected isBelowThreshold(
    body: unknown,
    options: CompressOptions = this.options,
  ): boolean {
    const threshold = options.threshold ?? 0;
    if (threshold <= 0) {
      return false;
    }
    if (typeof body === "string") {
      // `length` is at most the byte length, so a long string is settled
      // without measuring it.
      return body.length < threshold && Buffer.byteLength(body) < threshold;
    }
    if (Buffer.isBuffer(body) || body instanceof ArrayBuffer) {
      return body.byteLength < threshold;
    }
    return false;
  }

  protected isAllowedContentType(
    contentType: string | undefined,
    options: CompressOptions = this.options,
  ): boolean {
    if (!contentType) {
      return false;
    }

    const lowerContentType = contentType.toLowerCase();

    return !!options.allowedContentTypes.find((it) =>
      lowerContentType.includes(it),
    );
  }

  /**
   * Compress the response body in place. Returns a promise only when the
   * work is asynchronous: a buffered body above {@link SYNC_LIMIT}.
   */
  protected compress(
    encoding: keyof typeof ServerCompressProvider.compressors,
    response: ServerResponse,
  ): void | Promise<void> {
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
      const size =
        typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
      if (size <= ServerCompressProvider.SYNC_LIMIT) {
        this.setCompressed(
          response,
          encoding,
          compressor.compressSync(body, { params }),
        );
        return;
      }
      return compressor
        .compress(body, { params })
        .then((compressed) =>
          this.setCompressed(response, encoding, compressed),
        );
    }

    if (typeof body === "object" && body instanceof Readable) {
      this.setHeaders(response, encoding);
      // A proxied upstream may have declared its uncompressed length; the
      // client would stop reading the gzip body at that byte count.
      delete response.headers["content-length"];
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
      delete response.headers["content-length"];
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
   * A buffered body replaced by its compressed bytes, with its headers.
   */
  protected setCompressed(
    response: ServerResponse,
    encoding: string,
    compressed: Buffer,
  ): void {
    this.setHeaders(response, encoding);
    response.headers["content-length"] = compressed.length.toString();
    response.body = compressed;
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
      // zlib's default is quality 11, the level meant for assets compressed
      // once at build time. Per response it is the slowest step of the whole
      // request: a 10 KB JSON list answered 1k req/s (p50 61 ms) in br
      // against 13k uncompressed. Quality 4 is what CDNs use for dynamic
      // content, and stays smaller than gzip.
      return {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
      };
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
