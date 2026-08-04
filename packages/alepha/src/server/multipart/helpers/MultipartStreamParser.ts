import { AlephaError } from "alepha";

/**
 * One part of a multipart message, delivered before its content is read.
 *
 * **`data` is consume-once.** That is the whole reason this parser exists: a
 * part whose bytes can be read twice is a part whose bytes are retained, and
 * retaining them caps every upload at whatever fits in memory. Nothing here
 * holds more than one chunk plus a delimiter.
 *
 * The part is yielded as soon as its **headers** end, so a consumer can decide
 * where the bytes go — a bucket, a hash, the floor — before any arrive.
 */
export interface MultipartPart {
  /** The `name` of the form field, from `Content-Disposition`. */
  name?: string;
  /** The client-supplied filename. Absent for a plain field. */
  filename?: string;
  /** The part's `Content-Type`, absent when it did not declare one. */
  mediaType?: string;
  /** Every header of this part, lowercased. */
  headers: Record<string, string>;
  /**
   * The part's bytes, in arrival order.
   *
   * Must be consumed — fully or not at all — before advancing to the next
   * part. The parser drains whatever is left behind, because the delimiter of
   * the next part can only be found by walking past this one's content.
   */
  data: AsyncIterable<Uint8Array>;
}

/**
 * Thrown when a limit is exceeded. Named per limit, because the operator's
 * next move differs: a too-large file is a client to reject, too many parts is
 * usually an attack, and an oversized header is always one.
 */
export class MultipartLimitError extends AlephaError {
  constructor(
    message: string,
    public readonly limit: number,
    /**
     * Which budget was spent.
     *
     * Carried as data rather than left to be read out of the message, so a
     * caller can phrase the refusal in its own vocabulary — an HTTP layer
     * naming the field that overflowed, say — without matching on prose that
     * was never meant to be an interface.
     */
    public readonly kind: "header" | "file" | "parts" | "total",
  ) {
    super(message);
  }
}

/**
 * Thrown when the bytes are not a well-formed multipart message.
 */
export class MultipartParseError extends AlephaError {}

export interface MultipartParserOptions {
  /**
   * Maximum bytes of headers for a single part.
   *
   * Small on purpose: part headers are a filename and a content type. A
   * megabyte of them is not a use case, it is someone looking for a buffer to
   * grow.
   */
  maxHeaderBytes?: number;
  /**
   * Maximum bytes of content for a single part.
   *
   * **Counted, never trusted.** `Content-Length` is a claim by the sender; this
   * is a tally of bytes that actually arrived, so the refusal happens at the
   * first byte past the limit rather than after the whole body is in.
   */
  maxFileBytes?: number;
  /** Maximum number of parts in one message. */
  maxParts?: number;
  /**
   * Maximum bytes of the message, all of it.
   *
   * Content **and** everything walked to reach it: the preamble, and every
   * part's headers. It bounds reading rather than delivering, because a sender
   * that never emits a boundary costs just as much as one that emits content.
   */
  maxTotalBytes?: number;
}

/**
 * A streaming `multipart/form-data` parser.
 *
 * Written against RFC 2046 §5.1 and RFC 7578, on Web streams only, so one
 * implementation serves node, bun and workerd rather than three that drift.
 *
 * **Memory is flat.** The parser holds one source chunk plus, at most, the
 * length of a delimiter — because a delimiter can straddle two chunks and the
 * tail has to be kept until the next chunk proves it is content. That is the
 * only bookkeeping; the bytes of a part are handed out and forgotten.
 *
 * The alternative the platform offers, `Request.formData()`, cannot do this:
 * it yields `File` objects, a `File` is re-readable by specification, and
 * honouring re-readability forces the implementation to keep every byte.
 */
export class MultipartStreamParser {
  /** RFC 2046 §5.1.1 caps a boundary at 70 characters. */
  protected static readonly MAX_BOUNDARY_LENGTH = 70;

  protected static readonly DEFAULTS = {
    maxHeaderBytes: 16 * 1024,
    maxFileBytes: 5 * 1024 * 1024,
    maxParts: 10,
    maxTotalBytes: 10 * 1024 * 1024,
  };

  protected readonly maxHeaderBytes: number;
  protected readonly maxFileBytes: number;
  protected readonly maxParts: number;
  protected readonly maxTotalBytes: number;

  /** Unconsumed bytes. Never larger than one chunk plus a delimiter. */
  protected buffer: Uint8Array = new Uint8Array(0);
  protected reader?: ReadableStreamDefaultReader<Uint8Array>;
  protected done = false;
  protected partCount = 0;
  protected totalSize = 0;

  constructor(options: MultipartParserOptions = {}) {
    this.maxHeaderBytes =
      options.maxHeaderBytes ?? MultipartStreamParser.DEFAULTS.maxHeaderBytes;
    this.maxFileBytes =
      options.maxFileBytes ?? MultipartStreamParser.DEFAULTS.maxFileBytes;
    this.maxParts = options.maxParts ?? MultipartStreamParser.DEFAULTS.maxParts;
    this.maxTotalBytes =
      options.maxTotalBytes ?? MultipartStreamParser.DEFAULTS.maxTotalBytes;
  }

  /**
   * Reads the boundary out of a `Content-Type` header.
   *
   * Returns `undefined` rather than throwing when the header is not multipart
   * at all — that is a routing question, not a parse error.
   */
  public boundaryOf(
    contentType: string | undefined | null,
  ): string | undefined {
    if (!contentType || !/^multipart\//i.test(contentType.trim())) {
      return undefined;
    }
    // Quoted form first: a boundary may legally contain characters that would
    // otherwise end the parameter, and unquoted matching would truncate it.
    const match =
      /boundary="([^"]+)"/i.exec(contentType) ??
      /boundary=([^;\s]+)/i.exec(contentType);
    const boundary = match?.[1];
    if (!boundary) {
      throw new MultipartParseError(
        "multipart Content-Type carries no boundary parameter",
      );
    }
    if (boundary.length > MultipartStreamParser.MAX_BOUNDARY_LENGTH) {
      throw new MultipartParseError(
        `boundary is ${boundary.length} characters, over the 70 RFC 2046 allows`,
      );
    }
    return boundary;
  }

  /**
   * Walks a multipart body, yielding each part before its content arrives.
   *
   * The generator and each part's `data` share one cursor over the source, so
   * they cannot be consumed out of order: advancing to the next part drains
   * whatever the caller left, because the next delimiter lies past it.
   */
  public async *parse(
    body: ReadableStream<Uint8Array>,
    boundary: string,
  ): AsyncGenerator<MultipartPart, void, unknown> {
    this.reader = body.getReader();
    this.buffer = new Uint8Array(0);
    this.done = false;
    this.partCount = 0;
    this.totalSize = 0;

    // Every delimiter is preceded by CRLF except the very first, which may sit
    // at byte zero. Prepending one lets a single pattern find them all, and
    // costs two bytes instead of a special case that only the first part would
    // exercise — the case least likely to be covered by a test.
    this.buffer = this.encode("\r\n");

    const delimiter = this.encode(`\r\n--${boundary}`);

    try {
      // Skip the preamble: anything before the first delimiter is, per RFC
      // 2046, to be ignored rather than refused.
      if (!(await this.seek(delimiter))) {
        throw new MultipartParseError(
          "no multipart boundary found in the body",
        );
      }

      while (true) {
        const terminator = await this.readDelimiterSuffix();
        if (terminator === "close") {
          return;
        }

        if (++this.partCount > this.maxParts) {
          throw new MultipartLimitError(
            `More than ${this.maxParts} parts`,
            this.maxParts,
            "parts",
          );
        }

        const headers = await this.readHeaders();
        const disposition = this.parseDisposition(
          headers["content-disposition"],
        );

        let drained = false;
        const self = this;
        const part: MultipartPart = {
          name: disposition.name,
          filename: disposition.filename,
          mediaType: headers["content-type"],
          headers,
          data: {
            async *[Symbol.asyncIterator]() {
              if (drained) {
                throw new MultipartParseError(
                  "This part's data was already consumed — it is a stream, not a buffer",
                );
              }
              drained = true;
              yield* self.readContent(delimiter);
            },
          },
        };

        yield part;

        // Whatever the consumer ignored still has to be walked: the next
        // delimiter is on the far side of it. Dropping the bytes as they pass
        // costs nothing and keeps a skipped part from being a leak.
        if (!drained) {
          drained = true;
          for await (const _ of this.readContent(delimiter)) {
            // discarded on purpose
          }
        }
      }
    } finally {
      await this.reader.cancel().catch(() => {
        // A source that refuses to close is not this parser's problem to
        // report, and throwing here would mask the real error.
      });
      this.reader = undefined;
    }
  }

  /**
   * Yields a part's content up to the next delimiter.
   *
   * The hold-back is what makes this correct: the last `delimiter.length - 1`
   * bytes of the buffer are kept, because a delimiter starting there would be
   * completed by the next chunk. Emitting them would cut a part's content into
   * the middle of a boundary and hand the caller bytes that are not theirs.
   */
  protected async *readContent(
    delimiter: Uint8Array,
  ): AsyncGenerator<Uint8Array, void, unknown> {
    let size = 0;

    while (true) {
      const at = this.indexOf(this.buffer, delimiter);
      if (at >= 0) {
        const content = this.buffer.subarray(0, at);
        this.count(content.length, size);
        size += content.length;
        this.buffer = this.buffer.subarray(at + delimiter.length);
        if (content.length > 0) {
          yield content;
        }
        return;
      }

      const keep = delimiter.length - 1;
      if (this.buffer.length > keep) {
        const content = this.buffer.subarray(0, this.buffer.length - keep);
        this.count(content.length, size);
        size += content.length;
        this.buffer = this.buffer.subarray(this.buffer.length - keep);
        yield content;
      }

      if (!(await this.pull())) {
        throw new MultipartParseError(
          "body ended inside a part — no closing boundary",
        );
      }
    }
  }

  /**
   * Charges bytes against both budgets.
   *
   * Split from the emit loop so the two limits read as what they are: one
   * bounds a single upload, the other bounds a request that spreads the same
   * volume over many small parts to slip under the first.
   */
  protected count(length: number, sizeSoFar: number): void {
    if (sizeSoFar + length > this.maxFileBytes) {
      throw new MultipartLimitError(
        `A part exceeds ${this.maxFileBytes} bytes`,
        this.maxFileBytes,
        "file",
      );
    }
    this.spend(length);
  }

  /**
   * Charges bytes against the message budget alone.
   *
   * Separate from {@link count} because the message budget bounds *reading*,
   * not delivering: a preamble is discarded and a part's headers are never
   * handed to anyone, yet both are bytes this process was made to walk. Billing
   * only what reaches a consumer left two ways to spend an unbounded amount
   * under any budget — a preamble that never reaches a boundary, and headers
   * spread over many small parts. Neither grows memory, both spin forever, and
   * `Transfer-Encoding: chunked` carries no `Content-Length` for the cheap
   * pre-check to catch first.
   */
  protected spend(length: number): void {
    this.totalSize += length;
    if (this.totalSize > this.maxTotalBytes) {
      throw new MultipartLimitError(
        `The message exceeds ${this.maxTotalBytes} bytes`,
        this.maxTotalBytes,
        "total",
      );
    }
  }

  /**
   * Reads what follows a delimiter: `--` closes the message, CRLF opens a part.
   *
   * Linear whitespace between the two is tolerated because RFC 2046 allows it,
   * and a sender that emits it is not worth a failed upload.
   */
  protected async readDelimiterSuffix(): Promise<"open" | "close"> {
    await this.want(2);
    if (this.buffer[0] === 0x2d && this.buffer[1] === 0x2d) {
      return "close";
    }

    let i = 0;
    while (this.buffer[i] === 0x20 || this.buffer[i] === 0x09) {
      i++;
      if (i >= this.buffer.length && !(await this.pull())) {
        break;
      }
    }
    // `want` again, and past `i` this time: the one above ran before the
    // whitespace was walked, so it guaranteed two bytes at position 0, not at
    // the CRLF. Reading `buffer[i + 1]` on its word turned a body whose CR and
    // LF landed in different chunks into a parse error — the same upload
    // succeeding or failing on where TCP happened to cut it.
    if (this.buffer.length < i + 2) {
      await this.want(i + 2).catch(() => {
        // End of stream: the message is genuinely truncated, and the refusal
        // below says so in the vocabulary this method already uses.
      });
    }
    if (this.buffer[i] === 0x0d && this.buffer[i + 1] === 0x0a) {
      this.buffer = this.buffer.subarray(i + 2);
      return "open";
    }
    throw new MultipartParseError(
      "a boundary was followed by neither a part nor the end of the message",
    );
  }

  /**
   * Reads a part's headers, up to the blank line that ends them.
   */
  protected async readHeaders(): Promise<Record<string, string>> {
    const separator = this.encode("\r\n\r\n");

    while (true) {
      const at = this.indexOf(this.buffer, separator);
      if (at >= 0) {
        this.spend(at + separator.length);
        const raw = this.decode(this.buffer.subarray(0, at));
        this.buffer = this.buffer.subarray(at + separator.length);
        return this.parseHeaders(raw);
      }
      if (this.buffer.length > this.maxHeaderBytes) {
        throw new MultipartLimitError(
          `Part headers exceed ${this.maxHeaderBytes} bytes`,
          this.maxHeaderBytes,
          "header",
        );
      }
      if (!(await this.pull())) {
        throw new MultipartParseError("body ended inside a part's headers");
      }
    }
  }

  protected parseHeaders(raw: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of raw.split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon <= 0) {
        continue;
      }
      headers[line.slice(0, colon).trim().toLowerCase()] = line
        .slice(colon + 1)
        .trim();
    }
    return headers;
  }

  /**
   * Pulls `name` and `filename` out of a `Content-Disposition`.
   *
   * `filename*` (RFC 5987) wins over `filename` when both are present, which is
   * what senders intend: the plain one is the ASCII fallback they expect to be
   * ignored by anything that understands the encoded form.
   *
   * Every pattern is anchored to the start of a parameter — `(?:^|;)\s*` —
   * rather than searched loose. Unanchored, `name=` matches **inside**
   * `filename=`, so `filename="x"; name="avatar"` reported the field as `x`:
   * legal input, no mandated parameter order, and the sender got to choose
   * which field of the route its part landed in.
   */
  protected parseDisposition(value: string | undefined): {
    name?: string;
    filename?: string;
  } {
    if (!value) {
      return {};
    }
    const at = (key: string) => `(?:^|;)\\s*${key}`;
    const quoted = (key: string) =>
      new RegExp(`${at(key)}="([^"]*)"`, "i").exec(value)?.[1] ??
      new RegExp(`${at(key)}=([^;]+)`, "i").exec(value)?.[1]?.trim();

    const extended = new RegExp(
      `${at("filename")}\\*=([^']*)'([^']*)'([^;]+)`,
      "i",
    ).exec(value);
    let filename = quoted("filename");
    if (extended) {
      try {
        filename = decodeURIComponent(extended[3].trim());
      } catch {
        // A malformed percent-encoding is not worth failing an upload over —
        // the ASCII `filename` is exactly the fallback it exists to be.
      }
    }

    return { name: quoted("name"), filename };
  }

  /**
   * Advances past the next occurrence of `needle`, discarding what precedes it.
   */
  protected async seek(needle: Uint8Array): Promise<boolean> {
    while (true) {
      const at = this.indexOf(this.buffer, needle);
      if (at >= 0) {
        this.spend(at);
        this.buffer = this.buffer.subarray(at + needle.length);
        return true;
      }
      const keep = needle.length - 1;
      if (this.buffer.length > keep) {
        this.spend(this.buffer.length - keep);
        this.buffer = this.buffer.subarray(this.buffer.length - keep);
      }
      if (!(await this.pull())) {
        return false;
      }
    }
  }

  /**
   * Ensures at least `n` bytes are buffered.
   */
  protected async want(n: number): Promise<void> {
    while (this.buffer.length < n) {
      if (!(await this.pull())) {
        throw new MultipartParseError("body ended where more was expected");
      }
    }
  }

  /**
   * Appends the next source chunk. Returns false at end of stream.
   */
  protected async pull(): Promise<boolean> {
    if (this.done || !this.reader) {
      return false;
    }
    const { value, done } = await this.reader.read();
    if (done) {
      this.done = true;
      return false;
    }
    if (!value || value.length === 0) {
      return this.pull();
    }
    const merged = new Uint8Array(this.buffer.length + value.length);
    merged.set(this.buffer, 0);
    merged.set(value, this.buffer.length);
    this.buffer = merged;
    return true;
  }

  /**
   * Plain forward search. The haystack is one chunk, so the naive scan is the
   * right one — an index would cost more to build than it saves.
   */
  protected indexOf(haystack: Uint8Array, needle: Uint8Array): number {
    const last = haystack.length - needle.length;
    outer: for (let i = 0; i <= last; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) {
          continue outer;
        }
      }
      return i;
    }
    return -1;
  }

  protected encode(value: string): Uint8Array {
    return new TextEncoder().encode(value);
  }

  protected decode(value: Uint8Array): string {
    return new TextDecoder().decode(value);
  }
}
