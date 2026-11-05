import type { RouteMethod } from "../constants/routeMethods.ts";
import type {
  RequestGeo,
  RequestReferer,
  ServerRawRequest,
  ServerRequestData,
} from "../interfaces/ServerRequest.ts";
import type { ServerRequestParser } from "../services/ServerRequestParser.ts";
import type { UserAgentInfo } from "../services/UserAgentParser.ts";
import { ServerReply } from "./ServerReply.ts";

/**
 * The {@link ServerRequest} a server hands its pipeline: the parsed fields,
 * plus the derived ones (`ip`, `userAgent`, `geo`...) computed when read.
 *
 * A class, not an object literal: the literal declared its nine getters
 * afresh for every request, nine closures and an accessor map each time,
 * about 3% of a small request. Here they live once, on the prototype.
 */
export class ParsedServerRequest {
  public method: RouteMethod;
  public url: URL;
  public raw: ServerRawRequest;
  public signal: AbortSignal;
  public headers: Record<string, string>;
  public query: Record<string, any>;
  public params: Record<string, string>;
  /**
   * Filled by the body parser.
   */
  public body: any = null;
  public metadata: Record<string, any> = {};
  /**
   * A plain `new`, like every other reply in the framework: a transient
   * `inject` walked the container (substitutions, instantiation stack,
   * primitive scan of the instance) once per request, for a class with no
   * dependencies.
   */
  public reply: ServerReply = new ServerReply();

  protected readonly parser: ServerRequestParser;
  protected readonly data: ServerRequestData;
  protected cachedRequestId?: string;

  public constructor(
    parser: ServerRequestParser,
    data: ServerRequestData,
    signal: AbortSignal,
  ) {
    this.parser = parser;
    this.data = data;
    this.method = data.method;
    this.url = data.url;
    this.raw = data.raw;
    this.signal = signal;
    this.headers = data.headers;
    this.query = data.query;
    this.params = data.params;
  }

  /**
   * Memoised per request: the getter used to mint a fresh randomUUID on
   * every access, so the id in the log line, the id in the error body and
   * the ids read by middleware were all different, and nothing could be
   * correlated.
   */
  public get requestId(): string {
    this.cachedRequestId ??= this.parser.getRequestId(this.data);
    return this.cachedRequestId;
  }

  public get ip(): string | undefined {
    return this.parser.getRequestIp(this.data);
  }

  public get userAgent(): UserAgentInfo {
    return this.parser.getRequestUserAgent(this.data);
  }

  public get geo(): RequestGeo {
    return this.parser.getRequestGeo(this.data);
  }

  public get isBot(): boolean {
    return this.parser.getIsBot(this.data);
  }

  public get isMobile(): boolean {
    return this.parser.getIsMobile(this.data);
  }

  public get protocol(): "http" | "https" {
    return this.parser.getProtocol(this.data);
  }

  public get language(): string | undefined {
    return this.parser.getLanguage(this.data);
  }

  public get referer(): RequestReferer | undefined {
    return this.parser.getReferer(this.data);
  }
}
