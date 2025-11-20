import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { ReadableStream as WebStream } from "node:stream/web";
import { $hook, $inject, Alepha, type FileLike, isTypeFile, t } from "alepha";
import { HttpError, isMultipart, type ServerRoute } from "alepha/server";

export class ServerMultipartProvider {
  protected readonly alepha = $inject(Alepha);

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
          body: WebStream.from(request.raw.node.req) as ReadableStream,
          duplex: "half",
        } as RequestInit & { duplex: "half" });
      }

      if (!webRequest) {
        return;
      }

      const contentType = request.headers["content-type"];

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

    if (route.schema?.body && t.schema.isObject(route.schema.body)) {
      for (const [key, value] of Object.entries(route.schema.body.properties)) {
        if (t.schema.isSchema(value)) {
          if (isTypeFile(value)) {
            const file = formData.get(key);
            // Check if file is a Blob (File extends Blob in Web APIs)
            if (file && typeof file === "object" && "arrayBuffer" in file) {
              const hybridFile = await this.createHybridFile(file as Blob, key);
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
