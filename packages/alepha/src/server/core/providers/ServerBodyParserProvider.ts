import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { ZType } from "alepha";
import { $atom, $hook, $inject, $store, Alepha, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import { HttpError } from "../errors/HttpError.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Body parser configuration atom.
 */
export const bodyParserOptions = $atom({
  name: "alepha.server.body-parser.options",
  schema: z.object({
    inflate: z
      .boolean()
      .describe("Enable decompression of request body.")
      .default(true),
    limit: z
      .integer()
      .meta({ min: 0 })
      .describe("Maximum size of request body in bytes.")
      .default(100_000),
  }),
  default: {
    inflate: true,
    limit: 100_000,
  },
  serverOnly: true,
});

export type BodyParserOptions = Infer<typeof bodyParserOptions.schema>;

declare module "alepha" {
  interface State {
    [bodyParserOptions.key]: BodyParserOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class ServerBodyParserProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly options = $store(bodyParserOptions);

  public readonly onRequest = $hook({
    on: "server:onRequest",
    handler: ({ route, request }) => {
      if (request.body) {
        return; // already parsed
      }

      // No body schema → this route consumes the body itself (raw handlers,
      // reverse proxies). Leave the underlying stream untouched: wrapping the
      // node Readable below locks it, so a later reader would get an empty
      // (drained) stream.
      if (!route.schema?.body) {
        return;
      }

      let stream: ReadableStream | undefined;

      if (request.raw.web?.req.body) {
        stream = request.raw.web.req.body;
      } else if (request.raw.node?.req) {
        const nodeReq = request.raw.node.req as Readable & {
          body?: string | Buffer | object;
        };

        if (nodeReq.body !== undefined) {
          // Body was pre-consumed by the runtime (e.g., Vercel serverless).
          // The original stream is already drained — reconstruct from pre-parsed body.
          if (typeof nodeReq.body === "string") {
            stream = new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(nodeReq.body as string),
                );
                controller.close();
              },
            });
          } else if (Buffer.isBuffer(nodeReq.body)) {
            stream = new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(nodeReq.body as Buffer));
                controller.close();
              },
            });
          } else if (
            nodeReq.body !== null &&
            typeof nodeReq.body === "object"
          ) {
            // Already parsed as a JSON object — assign directly
            request.body = nodeReq.body;
            return;
          }
        } else {
          stream = Readable.toWeb(
            nodeReq as Readable,
          ) as unknown as ReadableStream;
        }
      }

      if (!stream) {
        return;
      }

      if (route.schema?.body) {
        const contentType = request.headers["content-type"] ?? "";

        // Skip body size check for multipart requests — ServerMultipartProvider
        // handles its own limits (multipartOptions.limit / fileLimit).
        if (!contentType.startsWith("multipart/")) {
          const contentLength = request.headers["content-length"];
          if (contentLength) {
            const size = Number.parseInt(contentLength, 10);
            if (!Number.isNaN(size) && size > this.options.limit) {
              throw new HttpError({
                status: 413,
                message: "Request body size limit exceeded",
              });
            }
          }
        }

        return this.parse(stream, request.headers, route.schema.body)
          .then((body) => {
            if (body) {
              request.body = body;
            }
          })
          .catch((error) => {
            if (error instanceof HttpError) {
              throw error;
            }
            throw new HttpError(
              {
                status: 400,
                message: "Failed to parse request body",
              },
              error,
            );
          });
      }
    },
  });

  public async parse(
    stream: ReadableStream,
    headers: Record<string, string>,
    schema: ZType,
  ): Promise<object | string | undefined> {
    const contentType = headers["content-type"];
    const contentEncoding = headers["content-encoding"];

    if (!contentType) return undefined;

    if (contentType.startsWith("text/plain") || z.schema.isString(schema)) {
      return this.parseText(stream, contentEncoding);
    }

    if (contentType.startsWith("application/json")) {
      return this.parseJson(stream, contentEncoding);
    }

    if (contentType.startsWith("application/x-www-form-urlencoded")) {
      return this.parseUrlEncoded(stream, contentEncoding);
    }

    return undefined;
  }

  public async parseText(
    stream: ReadableStream,
    contentEncoding?: string,
  ): Promise<string> {
    const buffer = await this.streamToBuffer(stream);
    const bufferInflated = await this.maybeDecompress(buffer, contentEncoding);
    return bufferInflated.toString("utf-8");
  }

  public async parseUrlEncoded(
    stream: ReadableStream,
    contentEncoding?: string,
  ): Promise<object> {
    const text = await this.parseText(stream, contentEncoding);
    const params = new URLSearchParams(text);
    const result: Record<string, string | string[]> = {};

    for (const key of params.keys()) {
      const values = params.getAll(key);
      result[key] = values.length === 1 ? values[0] : values;
    }

    return result;
  }

  public async parseJson(
    stream: ReadableStream,
    contentEncoding?: string,
  ): Promise<object> {
    const text = await this.parseText(stream, contentEncoding);
    return JSON.parse(text);
  }

  protected async maybeDecompress(
    buffer: Buffer,
    encoding: string | undefined,
  ): Promise<Buffer> {
    if (!this.options.inflate && encoding) {
      throw new HttpError({
        status: 415,
        message: `Content-Encoding ${encoding} not allowed`,
      });
    }

    switch (encoding) {
      case "gzip":
        return this.decompressBuffer(buffer, createGunzip());
      case "deflate":
        return this.decompressBuffer(buffer, createInflate());
      case "br":
        return this.decompressBuffer(buffer, createBrotliDecompress());
      case undefined:
      case "identity":
        return buffer;
      default:
        throw new HttpError({
          status: 415,
          message: `Unsupported Content-Encoding: ${encoding}`,
        });
    }
  }

  protected decompressBuffer(
    buffer: Buffer,
    transform:
      | import("node:zlib").BrotliDecompress
      | import("node:zlib").Gunzip
      | import("node:zlib").Inflate,
  ): Promise<Buffer> {
    const maxDecompressed = this.options.limit * 10;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      transform
        .on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxDecompressed) {
            transform.destroy();
            reject(
              new HttpError({
                status: 413,
                message: "Decompressed body size limit exceeded",
              }),
            );
            return;
          }
          chunks.push(chunk);
        })
        .on("end", () => resolve(Buffer.concat(chunks)))
        .on("error", reject);
      transform.end(buffer);
    });
  }

  /**
   * Convert Web ReadableStream to Buffer, with a size limit.
   */
  protected async streamToBuffer(stream: ReadableStream): Promise<Buffer> {
    const limit = this.options.limit;
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    const reader = stream.getReader();
    let needsCancel = true;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          needsCancel = false;
          break;
        }

        if (value) {
          totalLength += value.length;

          if (totalLength > limit) {
            this.log.error(
              `Body size limit exceeded: ${totalLength} > ${limit}`,
            );

            throw new HttpError({
              status: 413,
              message: "Request body size limit exceeded",
            });
          }

          chunks.push(value);
        }
      }

      const combined = new Uint8Array(totalLength);
      let offset = 0;

      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      return Buffer.from(
        combined.buffer,
        combined.byteOffset,
        combined.byteLength,
      );
    } finally {
      if (needsCancel) {
        await reader.cancel().catch(() => {});
      }
      reader.releaseLock();
    }
  }
}
