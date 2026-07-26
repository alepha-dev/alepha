import { Readable } from "node:stream";
import {
  $atom,
  $hook,
  $inject,
  $state,
  Alepha,
  type FileLike,
  isTypeFile,
  type Static,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import { HttpError, isMultipart, type ServerRoute } from "alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Multipart configuration atom.
 */
export const multipartOptions = $atom({
  name: "alepha.server.multipart.options",
  schema: z.object({
    limit: z
      .integer()
      .meta({ min: 0 })
      .describe("Maximum total size of multipart request body in bytes.")
      .default(10_000_000),
    fileLimit: z
      .integer()
      .meta({ min: 0 })
      .describe("Maximum size of a single file in bytes.")
      .default(5_000_000),
    fileCount: z
      .integer()
      .meta({ min: 1 })
      .describe("Maximum number of files allowed in a single request.")
      .default(10),
  }),
  default: {
    limit: 10_000_000,
    fileLimit: 5_000_000,
    fileCount: 10,
  },
  serverOnly: true,
});

export type MultipartOptions = Static<typeof multipartOptions.schema>;

declare module "alepha" {
  interface State {
    [multipartOptions.key]: MultipartOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Parses `multipart/form-data` request bodies into route handler input.
 *
 * **This provider buffers.** It reads the entire request body into memory via
 * `request.formData()` before the handler runs, and each file field is handed
 * to the handler as an in-memory, `Blob`-backed `FileLike`. It does **not**
 * stream uploads to the storage layer — by the time `bucket.upload` runs, the
 * bytes are already fully in RAM.
 *
 * This is a deliberate trade-off, kept safe by the `multipartOptions` limits
 * (default 5 MB/file, 10 MB total, 10 files): the framework targets small
 * uploads (avatars, attachments, documents), so buffering keeps validation
 * simple and exact (`blob.size` is known up front) without a streaming
 * multipart parser. If you need large-file uploads, raise those limits only
 * alongside a streaming parser — buffering 100 MB per request will exhaust
 * memory (and blow the Workers memory ceiling).
 *
 * @see multipartOptions for the size/count limits that bound the buffering.
 */
export class ServerMultipartProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly options = $state(multipartOptions);

  public readonly onRequest = $hook({
    on: "server:onRequest",
    handler: async ({ route, request }) => {
      if (request.body) {
        return;
      }

      if (!route.schema?.body) {
        return;
      }

      let webRequest: Request | undefined;

      if (request.raw.web?.req) {
        webRequest = request.raw.web.req;
      } else if (request.raw.node?.req) {
        webRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: Readable.toWeb(
            request.raw.node.req as Readable,
          ) as unknown as ReadableStream,
          duplex: "half",
        } as RequestInit & { duplex: "half" });
      }

      if (!webRequest) {
        return;
      }

      const contentType = request.headers["content-type"];

      // Check content-length before processing to fail fast on oversized requests
      const contentLength = request.headers["content-length"];
      if (contentLength) {
        const size = Number.parseInt(contentLength, 10);
        if (!Number.isNaN(size) && size > this.options.limit) {
          this.log.error(
            `Multipart request size limit exceeded: ${size} > ${this.options.limit}`,
          );
          throw new HttpError({
            status: 413,
            message: `Request body size limit exceeded. Maximum allowed: ${this.options.limit} bytes`,
          });
        }
      }

      if (!contentType?.startsWith("multipart/form-data")) {
        if (!isMultipart(route)) {
          return;
        }

        throw new HttpError({
          status: 415,
          message: `Invalid content-type: ${contentType} - only "multipart/form-data" is accepted`,
        });
      }

      request.body = await this.parseMultipart(route, webRequest);
    },
  });

  public async parseMultipart(
    route: ServerRoute,
    request: Request,
  ): Promise<Record<string, unknown>> {
    let formData: FormData;

    try {
      formData = await this.limitBodySize(request).formData();
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      if (error instanceof Error && error.cause instanceof HttpError) {
        throw error.cause;
      }
      throw new HttpError(
        {
          status: 400,
          message: "Malformed multipart/form-data",
        },
        error,
      );
    }

    return this.parseFormData(route, formData);
  }

  /**
   * Wrap the request body in a counting stream that aborts past
   * `options.limit`. The content-length fail-fast check can't protect
   * against `Transfer-Encoding: chunked` (no length header), and
   * `formData()` would otherwise buffer the entire body into RAM.
   */
  protected limitBodySize(request: Request): Request {
    const body = request.body;
    if (!body) {
      return request;
    }

    const limit = this.options.limit;
    let received = 0;

    const limited = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          received += chunk.byteLength;
          if (received > limit) {
            controller.error(
              new HttpError({
                status: 413,
                message: `Request body size limit exceeded. Maximum allowed: ${limit} bytes`,
              }),
            );
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );

    return new Request(request, {
      body: limited,
      duplex: "half",
    } as RequestInit);
  }

  protected async parseFormData(
    route: ServerRoute,
    formData: FormData,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, any> = {};
    let fileCount = 0;
    let totalSize = 0;

    if (route.schema?.body && z.schema.isObject(route.schema.body)) {
      for (const [key, value] of Object.entries(route.schema.body.properties)) {
        if (!z.schema.isSchema(value)) {
          continue;
        }

        if (isTypeFile(value)) {
          const file = formData.get(key);
          if (file && typeof file === "object" && "arrayBuffer" in file) {
            const blob = file as Blob;

            fileCount++;
            if (fileCount > this.options.fileCount) {
              this.log.error(
                `Too many files in multipart request: ${fileCount} > ${this.options.fileCount}`,
              );
              throw new HttpError({
                status: 413,
                message: `Too many files. Maximum allowed: ${this.options.fileCount}`,
              });
            }

            if (blob.size > this.options.fileLimit) {
              this.log.error(
                `File "${key}" exceeds size limit: ${blob.size} > ${this.options.fileLimit}`,
              );
              throw new HttpError({
                status: 413,
                message: `File "${key}" exceeds size limit. Maximum allowed: ${this.options.fileLimit} bytes`,
              });
            }

            totalSize += blob.size;
            if (totalSize > this.options.limit) {
              this.log.error(
                `Total multipart size exceeds limit: ${totalSize} > ${this.options.limit}`,
              );
              throw new HttpError({
                status: 413,
                message: `Total request size exceeds limit. Maximum allowed: ${this.options.limit} bytes`,
              });
            }

            body[key] = this.blobToFileLike(blob, key);
          }
        } else {
          const fieldValue = formData.get(key);
          if (fieldValue !== null) {
            const stringValue =
              typeof fieldValue === "string" ? fieldValue : "";
            body[key] = this.alepha.codec.decode(value, stringValue);
          }
        }
      }
    }

    return body;
  }

  protected blobToFileLike(blob: Blob, fieldName: string): FileLike {
    const isFile = blob instanceof File;

    return {
      name: isFile ? blob.name : `${fieldName}_${Date.now()}`,
      type: blob.type || "application/octet-stream",
      size: blob.size,
      lastModified: isFile ? blob.lastModified : Date.now(),

      stream() {
        return blob.stream() as unknown as ReadableStream;
      },

      arrayBuffer() {
        return blob.arrayBuffer();
      },

      text() {
        return blob.text();
      },
    };
  }
}
