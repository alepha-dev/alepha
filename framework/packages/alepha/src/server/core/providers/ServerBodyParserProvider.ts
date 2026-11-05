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
    on: "server:request:before",
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
          // The plain Node request: read it as a Node stream. Wrapping it in
          // `Readable.toWeb` cost a Web Streams adapter, a promise per chunk
          // and a copy, which made POST the slowest path next to Express.
          return this.parseNodeRequest(nodeReq as Readable, request, route);
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
              throw new HttpError(
                { status: 413 },
                { message: "Request body size limit exceeded" },
              );
            }
          }
        }

        return (
          this.parse(stream, request.headers, route.schema.body)
            // Assigns onto the request and hands nothing on; the `.catch` below is what
            // the chain exists for.
            // oxlint-disable-next-line promise/always-return
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
                { status: 400 },
                { message: "Failed to parse request body", cause: error },
              );
            })
        );
      }
    },
  });

  /**
   * The body of a plain Node request, read from its own stream, with the
   * same size limits and the same errors as the Web stream path.
   */
  protected parseNodeRequest(
    nodeReq: Readable,
    request: { headers: Record<string, string>; body: unknown },
    route: { schema?: { body?: ZType } },
  ): Promise<void> | undefined {
    const schema = route.schema?.body;
    if (!schema) {
      return;
    }

    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.startsWith("multipart/")) {
      const contentLength = request.headers["content-length"];
      if (contentLength) {
        const size = Number.parseInt(contentLength, 10);
        if (!Number.isNaN(size) && size > this.options.limit) {
          throw new HttpError(
            { status: 413 },
            { message: "Request body size limit exceeded" },
          );
        }
      }
    }

    const kind = this.bodyKind(request.headers, schema);
    if (!kind) {
      return;
    }

    return (
      this.nodeStreamToBuffer(nodeReq)
        .then((buffer) => this.parseBuffer(kind, buffer, request.headers))
        // Assigns onto the request and hands nothing on, like the Web path.
        // oxlint-disable-next-line promise/always-return
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
            { status: 400 },
            { message: "Failed to parse request body", cause: error },
          );
        })
    );
  }

  /**
   * Which parser a body takes, from its content type and the route's
   * schema, the same order {@link parse} follows. `undefined` reads nothing.
   */
  protected bodyKind(
    headers: Record<string, string>,
    schema: ZType,
  ): "text" | "json" | "urlencoded" | undefined {
    const contentType = headers["content-type"];
    if (!contentType) return undefined;
    if (contentType.startsWith("text/plain") || z.schema.isString(schema)) {
      return "text";
    }
    if (contentType.startsWith("application/json")) return "json";
    if (contentType.startsWith("application/x-www-form-urlencoded")) {
      return "urlencoded";
    }
    return undefined;
  }

  protected async parseBuffer(
    kind: "text" | "json" | "urlencoded",
    buffer: Buffer,
    headers: Record<string, string>,
  ): Promise<object | string> {
    const inflated = await this.maybeDecompress(
      buffer,
      headers["content-encoding"],
    );
    const text = inflated.toString("utf-8");
    if (kind === "json") {
      return JSON.parse(text);
    }
    if (kind === "urlencoded") {
      return this.urlEncodedToObject(text);
    }
    return text;
  }

  /**
   * A Node stream read to the end into one Buffer, refused past the size
   * limit like {@link streamToBuffer}.
   */
  protected nodeStreamToBuffer(stream: Readable): Promise<Buffer> {
    const limit = this.options.limit;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;

      const cleanup = () => {
        stream.off("data", onData);
        stream.off("end", onEnd);
        stream.off("error", onError);
        stream.off("close", onClose);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onData = (chunk: Buffer | string) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        total += buffer.length;
        if (total > limit) {
          this.log.warn(`Body size limit exceeded: ${total} > ${limit}`);
          // Stop reading; the rest of the upload is discarded with the request.
          stream.pause();
          fail(
            new HttpError(
              { status: 413 },
              { message: "Request body size limit exceeded" },
            ),
          );
          return;
        }
        chunks.push(buffer);
      };
      const onEnd = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total));
      };
      const onError = (error: Error) => fail(error);
      // A client that aborts mid-upload closes without `end`.
      const onClose = () =>
        fail(new Error("Request closed before its body ended"));

      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", onError);
      stream.on("close", onClose);
    });
  }

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
    return this.urlEncodedToObject(text);
  }

  /**
   * A form-urlencoded body as an object: a repeated key becomes an array.
   */
  protected urlEncodedToObject(text: string): object {
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
      throw new HttpError(
        { status: 415 },
        { message: `Content-Encoding ${encoding} not allowed` },
      );
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
        throw new HttpError(
          { status: 415 },
          { message: `Unsupported Content-Encoding: ${encoding}` },
        );
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
              new HttpError(
                { status: 413 },
                { message: "Decompressed body size limit exceeded" },
              ),
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
            this.log.warn(
              `Body size limit exceeded: ${totalLength} > ${limit}`,
            );

            throw new HttpError(
              { status: 413 },
              { message: "Request body size limit exceeded" },
            );
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
