import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
  ServerRawRequest,
  ServerRequestData,
} from "../interfaces/ServerRequest.ts";

/**
 * The {@link ServerRequestData} of a Node request, whose `url` is parsed
 * when something first reads it.
 *
 * Node hands over the request line as a string, and `new URL(path, base)`
 * cost about 440 ns per request (it parses the base each time), the largest
 * single allocation of a small request. The router matches on the raw
 * string, the request log line takes its path from it, and the protocol
 * comes from the same header that decides the base, so most requests never
 * need the URL object at all.
 */
export class NodeServerRequestData implements ServerRequestData {
  public readonly method: RouteMethod;
  public readonly headers: Record<string, string>;
  public readonly query: Record<string, string>;
  public readonly params: Record<string, string>;
  public readonly signal: AbortSignal;
  public raw: ServerRawRequest;

  /**
   * The request target as received: a path and its query, or the absolute
   * form a proxy may send.
   */
  public readonly rawUrl: string;

  /**
   * `http://` or `https://` followed by the `Host` header.
   */
  public readonly base: string;

  protected parsedUrl?: URL;

  public constructor(options: {
    method: RouteMethod;
    rawUrl: string;
    base: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    params: Record<string, string>;
    signal: AbortSignal;
    raw: ServerRawRequest;
  }) {
    this.method = options.method;
    this.rawUrl = options.rawUrl;
    this.base = options.base;
    this.headers = options.headers;
    this.query = options.query;
    this.params = options.params;
    this.signal = options.signal;
    this.raw = options.raw;
  }

  /**
   * The URL, parsed on first read.
   *
   * A path (`/...`, but not `//...`) is parsed in one string with the base,
   * which is the same URL `new URL(path, base)` gives at about 60% of the
   * cost. Anything else (the absolute form, a protocol-relative `//host/x`)
   * keeps the two-argument form and its meaning.
   */
  public get url(): URL {
    if (!this.parsedUrl) {
      const raw = this.rawUrl;
      this.parsedUrl =
        raw.charCodeAt(0) === 47 && raw.charCodeAt(1) !== 47
          ? new URL(this.base + raw)
          : new URL(raw, this.base);
    }
    return this.parsedUrl;
  }

  /**
   * The scheme the URL carries (`url.protocol`), without parsing it when the
   * request target is a path: the base decides it then. An absolute-form
   * target names its own, so it is parsed.
   */
  public get scheme(): string {
    if (this.rawUrl.charCodeAt(0) !== 47) {
      return this.url.protocol;
    }
    return this.base.startsWith("https:") ? "https:" : "http:";
  }
}
