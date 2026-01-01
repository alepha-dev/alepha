import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { ReadableStream as WebStream } from "node:stream/web";
import {
  $env,
  $hook,
  $inject,
  Alepha,
  type FileLike,
  isTypeFile,
  t,
} from "alepha";
import { $logger } from "alepha/logger";
import { HttpError, isMultipart, type ServerRoute } from "alepha/server";

const envSchema = t.object({
  SERVER_MULTIPART_LIMIT: t.integer({
    default: 10_000_000, // 10MB total
    min: 0,
    description: "Maximum total size of multipart request body in bytes.",
  }),
  SERVER_MULTIPART_FILE_LIMIT: t.integer({
    default: 5_000_000, // 5MB per file
    min: 0,
    description: "Maximum size of a single file in bytes.",
  }),
  SERVER_MULTIPART_FILE_COUNT: t.integer({
    default: 10,
    min: 1,
    description: "Maximum number of files allowed in a single request.",
  }),
});

export class ServerMultipartProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly log = $logger();

  public readonly onRequest = $hook({
    on: "server:onRequest",
    handler: async ({ route, request }) => {
      // already parsed (e.g. by body parser)
      if (request.body) {
        return;
      }

      // we do not parse body if no schema
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
          body: WebStream.from(
            request.raw.node.req,
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
        if (!Number.isNaN(size) && size > this.env.SERVER_MULTIPART_LIMIT) {
          this.log.error(
            `Multipart request size limit exceeded: ${size} > ${this.env.SERVER_MULTIPART_LIMIT}`,
          );
          throw new HttpError({
            status: 413,
            message: `Request body size limit exceeded. Maximum allowed: ${this.env.SERVER_MULTIPART_LIMIT} bytes`,
          });
        }
      }

      if (!contentType?.startsWith("multipart/form-data")) {
        if (!isMultipart(route)) {
          return;
        }

        // route expects multipart but content-type is not correct! reject with 415
        throw new HttpError({
          status: 415,
          message: `Invalid content-type: ${contentType} - only "multipart/form-data" is accepted`,
        });
      }

      const { body, cleanup } = await this.handleMultipartBodyFromWeb(
        route,
        webRequest,
      );

      request.body = body;
      request.metadata.multipart = { cleanup };
    },
  });

  public readonly onResponse = $hook({
    on: "server:onResponse",
    handler: async ({ request }) => {
      const cleanup = request.metadata.multipart?.cleanup;
      if (typeof cleanup === "function") {
        await cleanup();
      }
    },
  });

  public async handleMultipartBodyFromWeb(
    route: ServerRoute,
    request: Request,
  ): Promise<{
    body: Record<string, unknown>;
    cleanup: () => Promise<void>;
  }> {
    let formData: FormData;

    try {
      // Parse the FormData from the request
      formData = await request.formData();
    } catch (error) {
      throw new HttpError(
        {
          status: 400,
          message: "Malformed multipart/form-data",
        },
        error,
      );
    }

    const body: Record<string, any> = {};
    const tempFiles: HybridFile[] = [];

    // Helper to clean up temp files on error
    const cleanupOnError = async () => {
      for (const file of tempFiles) {
        try {
          await file.cleanup();
        } catch {
          // Ignore cleanup errors during error handling
        }
      }
    };

    try {
      let fileCount = 0;
      let totalSize = 0;

      if (route.schema?.body && t.schema.isObject(route.schema.body)) {
        for (const [key, value] of Object.entries(
          route.schema.body.properties,
        )) {
          if (t.schema.isSchema(value)) {
            if (isTypeFile(value)) {
              const file = formData.get(key);
              // Check if file is a Blob (File extends Blob in Web APIs)
              if (file && typeof file === "object" && "arrayBuffer" in file) {
                const blob = file as Blob;

                // Validate file count
                fileCount++;
                if (fileCount > this.env.SERVER_MULTIPART_FILE_COUNT) {
                  this.log.error(
                    `Too many files in multipart request: ${fileCount} > ${this.env.SERVER_MULTIPART_FILE_COUNT}`,
                  );
                  throw new HttpError({
                    status: 413,
                    message: `Too many files. Maximum allowed: ${this.env.SERVER_MULTIPART_FILE_COUNT}`,
                  });
                }

                // Validate individual file size
                if (blob.size > this.env.SERVER_MULTIPART_FILE_LIMIT) {
                  this.log.error(
                    `File "${key}" exceeds size limit: ${blob.size} > ${this.env.SERVER_MULTIPART_FILE_LIMIT}`,
                  );
                  throw new HttpError({
                    status: 413,
                    message: `File "${key}" exceeds size limit. Maximum allowed: ${this.env.SERVER_MULTIPART_FILE_LIMIT} bytes`,
                  });
                }

                // Validate total size
                totalSize += blob.size;
                if (totalSize > this.env.SERVER_MULTIPART_LIMIT) {
                  this.log.error(
                    `Total multipart size exceeds limit: ${totalSize} > ${this.env.SERVER_MULTIPART_LIMIT}`,
                  );
                  throw new HttpError({
                    status: 413,
                    message: `Total request size exceeds limit. Maximum allowed: ${this.env.SERVER_MULTIPART_LIMIT} bytes`,
                  });
                }

                const hybridFile = await this.createHybridFile(blob, key);
                body[key] = hybridFile;
                tempFiles.push(hybridFile);
              }
            } else {
              const fieldValue = formData.get(key);
              if (fieldValue !== null) {
                // FormData values are either string or File/Blob
                const stringValue =
                  typeof fieldValue === "string" ? fieldValue : "";
                body[key] = this.alepha.codec.decode(value, stringValue);
              }
            }
          }
        }
      }

      return {
        body,
        cleanup: async () => {
          for (const file of tempFiles) {
            await file.cleanup();
          }
        },
      };
    } catch (error) {
      // Clean up any temp files that were created before the error
      await cleanupOnError();
      throw error;
    }
  }

  /**
   * This is a legacy code, previously we used "busboy" to parse multipart in Node.js environment.
   * Now we rely on Web Request's formData() method, which is supported in modern Node.js versions.
   * However, we still need to create temporary files for uploaded files to provide a consistent File-like interface.
   *
   * TODO: In future, we might want to refactor this to avoid using temporary files if not necessary?
   */
  protected async createHybridFile(
    file: Blob,
    fieldName: string,
  ): Promise<HybridFile> {
    const tmpPath = `${os.tmpdir()}/${randomUUID()}`;

    // Get file data
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Write to temp file
    await writeFile(tmpPath, buffer);

    // Get file name - check if it has name property (File type)
    const fileName = (file as any).name || `${fieldName}_${Date.now()}`;

    const hybridFile: HybridFile = {
      _state: {
        cleanup: false,
        size: file.size,
        tmpPath,
      },
      name: fileName,
      type: file.type || "application/octet-stream",
      lastModified: (file as any).lastModified || Date.now(),
      filepath: tmpPath,
      get size() {
        return this._state.size;
      },
      stream() {
        return createReadStream(tmpPath);
      },
      async arrayBuffer() {
        const content = await readFile(tmpPath);
        return content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength,
        ) as ArrayBuffer;
      },
      text: async () => {
        return await readFile(tmpPath, "utf-8");
      },
      async cleanup() {
        if (this._state.cleanup) {
          return;
        }

        await unlink(tmpPath); // clean up the temp file
        this._state.cleanup = true;
      },
    };

    return hybridFile;
  }
}

interface HybridFile extends FileLike {
  cleanup(): Promise<void>;
  _state: {
    cleanup: boolean;
    size: number;
    tmpPath: string;
  };
}
