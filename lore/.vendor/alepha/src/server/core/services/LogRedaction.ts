/**
 * The one place that decides what a log line is not allowed to say.
 *
 * There used to be two lists. `ServerLoggerProvider` carried a set of query
 * keys so an OAuth callback would not write a live authorization `code` into
 * production logs, and `HttpClient` carried a set of header names so a
 * request would not write its own session cookie there. Each fixed the leak
 * in front of it and neither knew about the other, so `HttpClient` still
 * logged its URL and its body verbatim: a login body with a plaintext
 * password was a larger leak than the header that had just been closed.
 *
 * One list, injected by both, is what stops the next one from drifting.
 *
 * Everything here is for logging only. It never touches the request that is
 * actually sent.
 */
export class LogRedaction {
  /**
   * Keys whose VALUE never reaches a log line, stored normalized (see
   * {@link normalize}), so `access_token`, `accessToken` and `access-token`
   * are one entry rather than three.
   *
   * The key itself is kept and only the value goes: knowing which parameters
   * a request carried is most of what the line is for.
   *
   * The set is the union of the two lists it replaces, plus the password
   * variants a change-password body uses. Over-redaction is the safe
   * direction here: a redacted value costs a debugging session, a leaked one
   * costs the account. `code` earns its place twice over, as the OAuth
   * authorization code and as an emailed verification code.
   */
  protected readonly keys = new Set([
    "accesstoken",
    "apikey",
    "authorization",
    "clientsecret",
    "code",
    "currentpassword",
    "idtoken",
    "key",
    "newpassword",
    "oldpassword",
    "password",
    "refreshtoken",
    "secret",
    "state",
    "token",
  ]);

  /**
   * How far into a nested body to walk. A credential is near the top in
   * every real payload, and an unbounded walk over an attacker-shaped body
   * is work done on the logging path.
   */
  protected readonly maxDepth = 4;

  /**
   * Case and separators folded away, so one entry covers every spelling a
   * JSON body, a query string or a header might use for the same thing.
   */
  protected normalize(key: string): string {
    return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
  }

  public isSensitive(key: string): boolean {
    return this.keys.has(this.normalize(key));
  }

  /**
   * A query string with sensitive values replaced. Accepts the form with or
   * without its leading `?` and gives back the same form.
   *
   * The common case rebuilds nothing, so an ordinary query is logged byte
   * for byte as it arrived.
   */
  public query(search: string): string {
    const leading = search.startsWith("?");
    const raw = leading ? search.slice(1) : search;
    if (!raw) {
      return search;
    }

    const params = new URLSearchParams(raw);
    let sensitive = false;
    for (const key of params.keys()) {
      if (this.isSensitive(key)) {
        sensitive = true;
        break;
      }
    }
    if (!sensitive) {
      return search;
    }

    const parts: string[] = [];
    for (const [key, value] of params) {
      parts.push(
        this.isSensitive(key)
          ? `${encodeURIComponent(key)}=[redacted]`
          : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      );
    }
    return `${leading ? "?" : ""}${parts.join("&")}`;
  }

  /**
   * The request path as it should appear in a log line: the pathname, and a
   * query with its sensitive values replaced.
   */
  public path(url: URL): string {
    return url.search
      ? `${url.pathname}${this.query(url.search)}`
      : url.pathname;
  }

  /**
   * A whole URL as it should appear in a log line.
   *
   * Splits on the first `?` rather than parsing, so a relative URL is
   * handled like an absolute one and whatever form the caller passed comes
   * back unchanged when it carries nothing sensitive.
   */
  public url(raw: string): string {
    const hash = raw.indexOf("#");
    const head = hash < 0 ? raw : raw.slice(0, hash);
    const tail = hash < 0 ? "" : raw.slice(hash);
    const mark = head.indexOf("?");
    if (mark < 0) {
      return raw;
    }
    return `${head.slice(0, mark)}${this.query(head.slice(mark))}${tail}`;
  }

  /**
   * A request body as it should appear in a log line.
   *
   * Only a plain object or a JSON object/array is walked and redacted.
   * Anything else is reported by its type and size instead of its content,
   * which is both safer and more useful in a trace line: "ReadableStream" or
   * "FormData, 3 entries" says what a page of encoded bytes does not.
   */
  public body(value: unknown): unknown {
    if (value == null) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = this.parseJson(value);
      return parsed ? this.walk(parsed.value, 0) : this.describe(value);
    }
    if (this.isPlainObject(value)) {
      return this.walk(value, 0);
    }
    return this.describe(value);
  }

  /**
   * Structured JSON only. A bare string, number or boolean body parses but
   * has no keys to redact, so it is described rather than echoed.
   */
  protected parseJson(raw: string): { value: unknown } | undefined {
    const trimmed = raw.trim();
    if (trimmed[0] !== "{" && trimmed[0] !== "[") {
      return undefined;
    }
    try {
      return { value: JSON.parse(trimmed) };
    } catch {
      return undefined;
    }
  }

  protected walk(value: unknown, depth: number): unknown {
    if (depth > this.maxDepth) {
      return "[truncated]";
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.walk(entry, depth + 1));
    }
    if (!this.isPlainObject(value)) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = this.isSensitive(key)
        ? "[redacted]"
        : this.walk(entry, depth + 1);
    }
    return out;
  }

  /**
   * A plain data object, not a class instance. `FormData`, `Headers`, a
   * `Uint8Array` and a `ReadableStream` all fail this on purpose: walking
   * their own properties would say nothing about what they carry.
   */
  protected isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  protected describe(value: unknown): { type: string; size?: number } {
    const type =
      typeof value === "object" && value !== null
        ? (value.constructor?.name ?? "object")
        : typeof value;
    const size = this.sizeOf(value);
    return size === undefined ? { type } : { type, size };
  }

  /**
   * Whatever "how much of it is there" means for this shape. Undefined for
   * a stream, which cannot be measured without consuming it.
   */
  protected sizeOf(value: unknown): number | undefined {
    if (typeof value === "string") {
      return value.length;
    }
    if (value instanceof ArrayBuffer) {
      return value.byteLength;
    }
    if (ArrayBuffer.isView(value)) {
      return value.byteLength;
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return value.size;
    }
    if (typeof FormData !== "undefined" && value instanceof FormData) {
      return [...value.keys()].length;
    }
    if (value instanceof URLSearchParams) {
      return [...value.keys()].length;
    }
    return undefined;
  }
}
