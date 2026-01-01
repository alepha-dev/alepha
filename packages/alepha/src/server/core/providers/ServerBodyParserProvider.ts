import { ReadableStream as WebStream } from "node:stream/web";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { TSchema } from "alepha";
import { $env, $hook, $inject, Alepha, t } from "alepha";
import { $logger } from "alepha/logger";
import { HttpError } from "../errors/HttpError.ts";

const envSchema = t.object({
  SERVER_BODY_PARSER_INFLATE: t.boolean({
    default: true,
    description: "Enable decompression of request body.",
  }),
  SERVER_BODY_PARSER_LIMIT: t.integer({
    default: 100_000, // 100KB
    min: 0,
    description: "Maximum size of request body in bytes.",
  }),
});

export class ServerBodyParserProvider {
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();

  public readonly onRequest = $hook({
    on: "server:onRequest",
    handler: async ({ route, request }) => {
      if (request.body) {
        return; // already parsed
      }

      let stream: ReadableStream | undefined;

      if (request.raw.web?.req.body) {
        stream = request.raw.web.req.body;
      } else if (request.raw.node?.req) {
        // convert Node.js IncomingMessage to Web ReadableStream
        // TODO: check performance impact, it's better to directly read from Node stream!
        stream = WebStream.from(
          request.raw.node.req,
        ) as unknown as ReadableStream;
      }

      if (!stream) {
        return;
      }

      if (route.schema?.body) {
        try {
          const body = await this.parse(
            stream,
            request.headers,
            route.schema.body,
          );
          if (body) {
            request.body = body;
          }
        } catch (error) {
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
        }
      }
    },
  });

  public async parse(
    stream: ReadableStream,
    headers: Record<string, string>,
    schema: TSchema,
  ): Promise<object | string | undefined> {
    const contentType = headers["content-type"];
    const contentEncoding = headers["content-encoding"];

    if (!contentType) return undefined;

    if (contentType.startsWith("text/plain") || t.schema.isString(schema)) {
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
    const result: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
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
    if (!this.env.SERVER_BODY_PARSER_INFLATE && encoding) {
      throw new HttpError({
        status: 415,
        message: `Content-Encoding ${encoding} not allowed`,
      });
    }

    switch (encoding) {
      case "gzip":
        return new Promise((res, rej) =>
          createGunzip()
            .end(buffer, () => {})
            .on("data", res)
            .on("error", rej),
        );
      case "deflate":
        return new Promise((res, rej) =>
          createInflate()
            .end(buffer, () => {})
            .on("data", res)
            .on("error", rej),
        );
      case "br":
        return new Promise((res, rej) =>
          createBrotliDecompress()
            .end(buffer, () => {})
            .on("data", res)
            .on("error", rej),
        );
      case undefined:
      case "identity":
        return buffer;
      default:
        throw new Error(`Unsupported Content-Encoding: ${encoding}`);
    }
  }

  /**
   * Convert Web ReadableStream to Buffer, with a size limit.
   *
   * TODO: move to alepha/file FileUtils
   */
  protected async streamToBuffer(stream: ReadableStream): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (value) {
          totalLength += value.length;

          if (totalLength > this.env.SERVER_BODY_PARSER_LIMIT) {
            this.log.error(
              `Body size limit exceeded: ${totalLength} > ${this.env.SERVER_BODY_PARSER_LIMIT}`,
            );

            await reader.cancel(); // Cancel the stream

            throw new HttpError({
              status: 413,
              message: `Request body size limit exceeded`,
            });
          }

          chunks.push(value);
        }
      }

      // Combine all chunks into a single Buffer
      const combinedLength = chunks.reduce(
        (sum, chunk) => sum + chunk.length,
        0,
      );
      const combined = new Uint8Array(combinedLength);
      let offset = 0;

      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      return Buffer.from(combined);
    } catch (error) {
      // Make sure to release the reader lock
      reader.releaseLock();
      throw error;
    }
  }
}
