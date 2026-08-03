import { Readable } from "node:stream";
import {
  $atom,
  $hook,
  $inject,
  $store,
  Alepha,
  type FileLike,
  type Infer,
  isTypeFile,
  isTypeStream,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import {
  HttpError,
  isMultipart,
  type ServerRequest,
  type ServerRoute,
} from "alepha/server";
import {
  type MultipartCap,
  MultipartCapProvider,
  MultipartLimitError,
  MultipartParseError,
  type MultipartPart,
  MultipartStreamParser,
} from "alepha/server/multipart";

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

export type MultipartOptions = Infer<typeof multipartOptions.schema>;

declare module "alepha" {
  interface State {
    [multipartOptions.key]: MultipartOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Parses `multipart/form-data` request bodies into route handler input.
 *
 * **Each `z.file()` field is still materialised** — a `FileLike` promises to be
 * readable more than once, and honouring that means keeping the bytes. What
 * changed is that the ceiling is now decided per request instead of once for
 * the whole application, and that it is enforced by counting bytes as they
 * arrive rather than by trusting `Content-Length` and then buffering anyway.
 *
 * The budget is resolved at three levels, most specific last:
 *
 * 1. {@link multipartOptions} — the application-wide default.
 * 2. `z.file({ maxBytes })` on the route's own body schema.
 * 3. {@link MultipartCapProvider} — the only level that knows where the bytes
 *    are actually going, which is why it wins.
 *
 * A level can *raise* the ceiling, not merely lower it. That inversion was the
 * whole problem before: a bucket declaring `maxSize: 100` was silently capped
 * by a 5 MB global it knew nothing about, so the declaration read like a
 * promise the framework could not keep.
 *
 * ⚠️ Raising a ceiling on this path is not free. `$secure` runs *after* this
 * hook, so whatever budget is granted here is reachable before authentication —
 * a bigger number is a cheaper denial of service until the bytes stop being
 * buffered.
 *
 * @see MultipartStreamParser for the parser underneath, which holds one chunk
 * plus a delimiter regardless of payload size.
 */
export class ServerMultipartProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly options = $store(multipartOptions);
  protected readonly caps = $inject(MultipartCapProvider);

  /**
   * Default ceiling on one part's headers.
   *
   * Not in {@link multipartOptions} because nothing has ever needed to tune it:
   * part headers are a filename and a content type. It exists so an endless
   * header cannot grow a buffer, and 16 KB is far past any honest use.
   */
  protected static readonly DEFAULT_MAX_HEADER_SIZE = 16 * 1024;

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
      const caps = this.resolveCaps(request, route);

      // A courtesy, not a guard: `Content-Length` is the sender's claim, and a
      // chunked body carries none at all. Checking it saves an obviously
      // oversized upload the trip, while the parser below is what actually
      // enforces the budget — by counting.
      const contentLength = request.headers["content-length"];
      if (contentLength) {
        const size = Number.parseInt(contentLength, 10);
        if (!Number.isNaN(size) && size > caps.maxTotalBytes) {
          this.log.error(
            `Multipart request size limit exceeded: ${size} > ${caps.maxTotalBytes}`,
          );
          throw new HttpError({
            status: 413,
            message: `Request body size limit exceeded. Maximum allowed: ${caps.maxTotalBytes} bytes`,
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

      request.body = await this.parseMultipart(route, webRequest, caps);
    },
  });

  /**
   * Decides this request's size budget, most specific level last.
   *
   * A level may raise the ceiling, not only lower it — which is the point.
   * Raising `maxFileBytes` also lifts `maxTotalBytes` to match, because a
   * 100 MB file inside a 10 MB message is a limit that reads as granted and
   * refuses anyway.
   */
  protected resolveCaps(
    request: ServerRequest,
    route: ServerRoute,
  ): Required<MultipartCap> {
    const caps: Required<MultipartCap> = {
      maxFileBytes: this.options.fileLimit,
      maxTotalBytes: this.options.limit,
      maxParts: this.options.fileCount,
      maxHeaderBytes: ServerMultipartProvider.DEFAULT_MAX_HEADER_SIZE,
    };

    this.apply(caps, { maxFileBytes: this.declaredFileSize(route) });
    this.apply(caps, this.caps.resolve(request, route));

    return caps;
  }

  /**
   * Folds one level's answer into the budget, ignoring what it left unsaid.
   */
  protected apply(
    caps: Required<MultipartCap>,
    override: MultipartCap | undefined,
  ): void {
    if (!override) {
      return;
    }
    for (const key of [
      "maxFileBytes",
      "maxTotalBytes",
      "maxParts",
      "maxHeaderBytes",
    ] as const) {
      const value = override[key];
      if (typeof value === "number") {
        caps[key] = value;
      }
    }
    // A message has to be able to hold the file it is allowed to carry.
    if (
      override.maxFileBytes !== undefined &&
      override.maxTotalBytes === undefined
    ) {
      caps.maxTotalBytes = Math.max(caps.maxTotalBytes, override.maxFileBytes);
    }
  }

  /**
   * The largest budget the route declares, across `z.file()` and `z.stream()`.
   *
   * The largest rather than each field's own: the parser applies one ceiling to
   * every part, and enforcing the smallest would refuse the field that was
   * explicitly allowed to be bigger. Per-field precision belongs to whatever
   * validates the part after it arrives.
   */
  protected declaredFileSize(route: ServerRoute): number | undefined {
    if (!route.schema?.body || !z.schema.isObject(route.schema.body)) {
      return undefined;
    }
    let largest: number | undefined;
    for (const value of Object.values(z.schema.shape(route.schema.body))) {
      if (!isTypeFile(value) && !isTypeStream(value)) {
        continue;
      }
      const declared = z.schema.meta(value).maxBytes;
      if (
        typeof declared === "number" &&
        (largest === undefined || declared > largest)
      ) {
        largest = declared;
      }
    }
    return largest;
  }

  public async parseMultipart(
    route: ServerRoute,
    request: Request,
    caps: Required<MultipartCap> = this.resolveCaps(
      { headers: {} } as unknown as ServerRequest,
      route,
    ),
  ): Promise<Record<string, unknown>> {
    const parser = new MultipartStreamParser(caps);
    const contentType = request.headers.get("content-type");

    const fields =
      route.schema?.body && z.schema.isObject(route.schema.body)
        ? z.schema.shape(route.schema.body)
        : {};

    const body: Record<string, any> = {};
    let field: string | undefined;

    try {
      const boundary = parser.boundaryOf(contentType);
      if (!boundary || !request.body) {
        throw new MultipartParseError("multipart request carries no body");
      }

      // Driven by hand rather than with `for await`, because leaving that loop
      // calls `return()` on the generator — which runs its `finally`, cancels
      // the reader, and closes the very stream a `z.stream()` field is about to
      // hand to the handler. Suspending the iterator instead keeps it alive.
      const parts = parser
        .parse(request.body, boundary)
        [Symbol.asyncIterator]();

      while (true) {
        const next = await parts.next();
        if (next.done) {
          break;
        }
        const part = next.value;
        const key = part.name;
        // Remembered so a limit blown mid-part can name the field. The parser
        // has no idea what a form field is, and "a part exceeds 100 bytes" is
        // a worse thing to read than the name of the input that did it.
        field = key ?? undefined;
        // A field the schema does not declare is walked past, not refused: the
        // body is shaped by the route, and a client sending extra parts is not
        // an error the route has an opinion about.
        if (!key || !(key in fields)) {
          continue;
        }
        const schema = fields[key];
        if (!z.schema.isSchema(schema)) {
          continue;
        }

        if (isTypeStream(schema)) {
          // Handed over untouched, and the walk stops here. The handler pulls
          // these bytes — after `$secure`, after validation — which is what
          // makes a large ceiling cost bandwidth instead of memory, and what
          // keeps an unauthenticated caller from spending it at all.
          //
          // Whatever follows this part in the message is not read. A client
          // that wants other fields honoured sends them first; that ordering
          // is inherent to streaming, not a shortcut taken here.
          body[key] = this.guarded(part, key);
          return body;
        }

        if (isTypeFile(schema)) {
          body[key] = await this.materialise(part, key);
        } else {
          body[key] = this.alepha.codec.decode(schema, await this.textOf(part));
        }
      }
    } catch (error) {
      throw this.asHttpError(error, field);
    }

    return body;
  }

  /**
   * Turns the parser's error vocabulary into the HTTP one.
   *
   * The wording is deliberately the one this endpoint has always used. These
   * messages reach clients and are asserted by tests, so they are an interface:
   * changing them because the engine underneath changed would break callers for
   * no benefit they can see.
   */
  protected asHttpError(error: unknown, field?: string): HttpError {
    if (error instanceof HttpError) {
      return error;
    }

    if (error instanceof MultipartLimitError) {
      this.log.error(error.message);
      const message = this.limitMessage(error, field);
      return new HttpError({ status: 413, message }, error);
    }

    return new HttpError(
      { status: 400, message: "Malformed multipart/form-data" },
      error,
    );
  }

  protected limitMessage(error: MultipartLimitError, field?: string): string {
    switch (error.kind) {
      case "file":
        return field
          ? `File "${field}" exceeds size limit. Maximum allowed: ${error.limit} bytes`
          : `File exceeds size limit. Maximum allowed: ${error.limit} bytes`;
      case "total":
        // The same sentence the `Content-Length` check above uses. It is one
        // condition — the body is bigger than the budget — and it used to
        // carry two different messages depending on which guard happened to
        // notice first, which made the same refusal look like two.
        return `Request body size limit exceeded. Maximum allowed: ${error.limit} bytes`;
      case "parts":
        return `Too many files. Maximum allowed: ${error.limit}`;
      case "header":
        return `Part headers exceed size limit. Maximum allowed: ${error.limit} bytes`;
    }
  }

  /**
   * Re-dresses a streamed part so a blown limit still reads as a 413.
   *
   * With a materialised field the parser throws inside {@link parseMultipart},
   * where the refusal is translated. A streamed one is drained by the handler,
   * long after that `catch` has returned — so the same overflow surfaced as a
   * 500 and told the caller nothing. The translation has to travel with the
   * bytes.
   */
  protected guarded(part: MultipartPart, field: string): MultipartPart {
    const self = this;
    return {
      ...part,
      data: {
        async *[Symbol.asyncIterator]() {
          try {
            yield* part.data;
          } catch (error) {
            throw self.asHttpError(error, field);
          }
        },
      },
    };
  }

  /**
   * Collects a part into a `FileLike`.
   *
   * This is where the bytes stop streaming, and it is deliberate: `FileLike`
   * lets a handler call `arrayBuffer()` after `text()`, so the content has to
   * survive being read twice. The budget resolved above is what keeps that
   * honest — the parser refuses at the first byte past it, so nothing larger
   * than the route was granted ever reaches this method.
   */
  protected async materialise(
    part: MultipartPart,
    fieldName: string,
  ): Promise<FileLike> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of part.data) {
      chunks.push(chunk);
      size += chunk.length;
    }

    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }

    const name = part.filename ?? `${fieldName}_${Date.now()}`;
    const type = part.mediaType || "application/octet-stream";

    return {
      name,
      type,
      size,
      lastModified: Date.now(),
      stream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }) as unknown as ReturnType<FileLike["stream"]>,
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }

  /**
   * Reads a non-file part as text.
   */
  protected async textOf(part: MultipartPart): Promise<string> {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of part.data) {
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  }
}
