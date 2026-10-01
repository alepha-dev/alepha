import { $env, $inject, Alepha, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";

import { ServerReply } from "../helpers/ServerReply.ts";
import type {
  RequestGeo,
  RequestReferer,
  ServerRequest,
  ServerRequestData,
} from "../interfaces/ServerRequest.ts";
import { UserAgentParser } from "./UserAgentParser.ts";

const envSchema = z.object({
  /**
   * Trust proxy headers (X-Forwarded-For, X-Real-IP) for client IP resolution.
   *
   * Default: true (modern deployments are typically behind a reverse proxy)
   *
   * Set to false only if your server accepts direct connections without a proxy
   * and you want to use the raw connection IP.
   */
  TRUST_PROXY: z
    .boolean()
    .describe("Trust proxy headers for client IP")
    .meta({ secret: false })
    .default(true),

  /**
   * How many reverse proxies sit in front of this server.
   *
   * `X-Forwarded-For` is append-only and client-writable: a request may
   * arrive already carrying `X-Forwarded-For: 1.2.3.4` before any proxy
   * touched it. Only the entries the trusted proxies appended can be
   * believed, and those are the RIGHTMOST ones - so the client address is
   * the entry this many hops from the right.
   *
   * The default of 1 is the single-proxy deployment (Cloudflare, one Nginx,
   * one load balancer). Raise it only for a chain you actually control:
   * setting it too high walks left into attacker-supplied entries, which is
   * the very bug this exists to close.
   *
   * Ignored when `TRUST_PROXY` is false.
   */
  TRUST_PROXY_HOPS: z
    .integer()
    .min(1)
    .describe("Number of trusted reverse proxies in front of this server")
    .meta({ secret: false })
    .default(1),
});

export class ServerRequestParser {
  protected readonly alepha = $inject(Alepha);
  protected readonly userAgentParser = $inject(UserAgentParser);
  protected readonly cryptoProvider = $inject(CryptoProvider);
  protected readonly env = $env(envSchema);
  protected readonly rootURL = new URL("http://localhost/");

  public createServerRequest(
    partialRawRequest: Partial<ServerRequestData>,
  ): ServerRequest {
    const rawRequest = {
      method: "GET",
      url: this.rootURL,
      headers: {},
      query: {},
      params: {},
      ...partialRawRequest,
    } as ServerRequestData;
    // oxlint-disable-next-line typescript/no-this-alias -- the getters below are object-literal getters, whose `this` is the literal; an arrow cannot express a getter
    const self = this;
    let requestId: string | undefined;
    return {
      method: rawRequest.method,
      url: rawRequest.url,
      raw: rawRequest.raw,
      headers: rawRequest.headers,
      query: rawRequest.query,
      params: rawRequest.params,
      // ---------------------------------------------------------------------------------------------------------------
      // body will be filled by body parser middleware
      body: null,
      // ---------------------------------------------------------------------------------------------------------------
      metadata: {},
      reply: this.alepha.inject(ServerReply, { lifetime: "transient" }),
      // ---------------------------------------------------------------------------------------------------------------
      get requestId() {
        // Memoised per request: the getter used to mint a fresh randomUUID on
        // every access, so the id in the log line, the id in the error body
        // and the ids read by middleware were all different — nothing could
        // be correlated.
        requestId ??= self.getRequestId(rawRequest);
        return requestId;
      },
      get ip() {
        return self.getRequestIp(rawRequest);
      },
      get userAgent() {
        return self.getRequestUserAgent(rawRequest);
      },
      get geo() {
        return self.getRequestGeo(rawRequest);
      },
      get isBot() {
        return self.getIsBot(rawRequest);
      },
      get isMobile() {
        return self.getIsMobile(rawRequest);
      },
      get protocol() {
        return self.getProtocol(rawRequest);
      },
      get language() {
        return self.getLanguage(rawRequest);
      },
      get referer() {
        return self.getReferer(rawRequest);
      },
    } as ServerRequest;
  }

  /**
   * The active ALS context id, which is what every {@link LogEntry} emitted
   * during this request is tagged with.
   *
   * Resolving it here rather than minting a second id matters: `requestId` is
   * handed to the client in the error JSON, and it is the only handle a user
   * can quote back. Before this, absent a proxy-set `x-request-id`, the router
   * and the parser each called `randomUUID()` independently — so the id in the
   * response indexed nothing in the logs.
   *
   * The fallbacks cover callers that build a request outside any context
   * (direct `$action` invocation, tests).
   */
  public getRequestId(request: ServerRequestData): string {
    return (
      this.alepha.context.get<string>("context") ||
      request.headers["x-request-id"] ||
      request.headers["x-correlation-id"] ||
      this.cryptoProvider.randomUUID()
    );
  }

  public getRequestUserAgent(request: ServerRequestData) {
    return this.userAgentParser.parse(request.headers["user-agent"]);
  }

  /**
   * The client address, as far as it can be trusted.
   *
   * This value is the rate-limit key, so a client that can choose it can
   * choose which bucket it spends. `X-Forwarded-For` is append-only and
   * anyone may send one, so the LEFTMOST entry is whatever the client typed:
   * reading it let `X-Forwarded-For: evil` name its own bucket, and rotating
   * that string defeated the limiter entirely. Only the entries a trusted
   * proxy appended count, and those are on the right.
   */
  public getRequestIp(request: ServerRequestData): string | undefined {
    // Only trust proxy headers when explicitly configured
    if (this.env.TRUST_PROXY) {
      const headers = request.headers;

      // Cloudflare overwrites (never appends) `cf-connecting-ip` with the
      // address it accepted the connection from, so when it is present it is
      // the one header in this list a client cannot influence.
      const cfConnectingIp = this.firstHeaderValue(headers["cf-connecting-ip"]);
      if (cfConnectingIp) {
        return cfConnectingIp;
      }

      // X-Forwarded-For: standard proxy header (Vercel, Nginx, ELB, ...).
      const forwardedFor = this.parseForwardedFor(headers["x-forwarded-for"]);
      if (forwardedFor.length) {
        // Each trusted proxy appends the address it saw, so the client sits
        // `TRUST_PROXY_HOPS` entries from the right. Clamped, because a chain
        // shorter than the configured hop count means the request did not
        // come through the whole chain and the leftmost entry we have is the
        // furthest left we may believe.
        const index = Math.max(
          0,
          forwardedFor.length - this.env.TRUST_PROXY_HOPS,
        );
        return forwardedFor[index];
      }

      // X-Real-IP: alternative proxy header. Overwritten rather than
      // appended, so there is no chain to walk.
      const xRealIP = this.firstHeaderValue(headers["x-real-ip"]);
      if (xRealIP) {
        return xRealIP;
      }
    }

    // Default: use raw connection IP
    return this.getConnectionIp(request);
  }

  /**
   * Every `X-Forwarded-For` entry, in order, flattened across repeated
   * headers and comma-separated lists alike. Empty entries are dropped so a
   * trailing comma cannot shift the hop arithmetic.
   */
  protected parseForwardedFor(value: string | string[] | undefined): string[] {
    if (!value) {
      return [];
    }

    return (Array.isArray(value) ? value : [value])
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  protected firstHeaderValue(
    value: string | string[] | undefined,
  ): string | undefined {
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = raw?.trim();
    return trimmed ? trimmed : undefined;
  }

  protected getConnectionIp(request: ServerRequestData): string | undefined {
    // Get IP from raw connection (Node.js socket)
    const nodeReq = request.raw.node?.req;
    if (nodeReq) {
      return nodeReq.socket?.remoteAddress;
    }
    return undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Geolocation
  // ─────────────────────────────────────────────────────────────────────────────

  public getRequestGeo(request: ServerRequestData): RequestGeo {
    const headers = request.headers;

    return {
      // Country: Cloudflare, Vercel, AWS CloudFront
      country:
        headers["cf-ipcountry"] ||
        headers["x-vercel-ip-country"] ||
        headers["cloudfront-viewer-country"],

      // City: Cloudflare, Vercel
      city: headers["cf-ipcity"] || headers["x-vercel-ip-city"],

      // Region: Cloudflare, Vercel
      region:
        headers["cf-region"] ||
        headers["cf-region-code"] ||
        headers["x-vercel-ip-country-region"],

      // Coordinates: Cloudflare, Vercel
      latitude: headers["cf-iplatitude"] || headers["x-vercel-ip-latitude"],
      longitude: headers["cf-iplongitude"] || headers["x-vercel-ip-longitude"],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Bot detection
  // ─────────────────────────────────────────────────────────────────────────────

  protected static readonly BOT_PATTERNS = [
    /bot/i,
    /crawl/i,
    /spider/i,
    /slurp/i,
    /googlebot/i,
    /bingbot/i,
    /yandex/i,
    /baiduspider/i,
    /facebookexternalhit/i,
    /twitterbot/i,
    /linkedinbot/i,
    /whatsapp/i,
    /telegrambot/i,
    /discordbot/i,
    /slackbot/i,
    /applebot/i,
    /duckduckbot/i,
    /semrush/i,
    /ahrefsbot/i,
    /mj12bot/i,
    /dotbot/i,
    /petalbot/i,
    /bytespider/i,
    /gptbot/i,
    /claudebot/i,
    /anthropic/i,
    /curl/i,
    /wget/i,
    /python-requests/i,
    /axios/i,
    /node-fetch/i,
    /go-http-client/i,
    /java\//i,
    /libwww/i,
    /httpunit/i,
    /nutch/i,
    /phpcrawl/i,
    /biglotron/i,
    /teoma/i,
    /convera/i,
    /gigablast/i,
    /ia_archiver/i,
    /webmon/i,
    /httrack/i,
    /grub\.org/i,
    /netresearchserver/i,
    /speedy/i,
    /fluffy/i,
    /findlink/i,
    /panscient/i,
    /ips-agent/i,
    /yanga/i,
    /cyberpatrol/i,
    /postrank/i,
    /page2rss/i,
    /linkdex/i,
    /ezooms/i,
    /heritrix/i,
    /findthatfile/i,
    /europarchive\.org/i,
    /mappydata/i,
    /eright/i,
    /apercite/i,
    /aboundex/i,
    /domaincrawler/i,
    /wbsearchbot/i,
    /summify/i,
    /ccbot/i,
    /edisterbot/i,
    /seznambot/i,
    /ec2linkfinder/i,
    /gslfbot/i,
    /aihitbot/i,
    /intelium_bot/i,
    /yeti/i,
    /retrevopageanalyzer/i,
    /lb-spider/i,
    /sogou/i,
    /lssbot/i,
    /careerbot/i,
    /wotbox/i,
    /wocbot/i,
    /ichiro/i,
    /duckduckgo/i,
    /lssrocketcrawler/i,
    /drupact/i,
    /webcompanycrawler/i,
    /acoonbot/i,
    /openindexspider/i,
    /screaming frog/i,
    /pingdom/i,
    /uptimerobot/i,
    /headlesschrome/i,
    /phantomjs/i,
    /prerender/i,
    /lighthouse/i,
    /pagespeed/i,
  ];

  public getIsBot(request: ServerRequestData): boolean {
    const ua = request.headers["user-agent"];
    if (!ua) return false;

    return ServerRequestParser.BOT_PATTERNS.some((pattern) => pattern.test(ua));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mobile detection
  // ─────────────────────────────────────────────────────────────────────────────

  protected static readonly MOBILE_PATTERNS = [
    /android/i,
    /webos/i,
    /iphone/i,
    /ipad/i,
    /ipod/i,
    /blackberry/i,
    /iemobile/i,
    /opera mini/i,
    /mobile/i,
    /tablet/i,
    /kindle/i,
    /silk/i,
    /fennec/i,
    /windows phone/i,
    /windows ce/i,
    /symbian/i,
    /palm/i,
    /webmate/i,
  ];

  public getIsMobile(request: ServerRequestData): boolean {
    const ua = request.headers["user-agent"];
    if (!ua) return false;

    return ServerRequestParser.MOBILE_PATTERNS.some((pattern) =>
      pattern.test(ua),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Protocol detection
  // ─────────────────────────────────────────────────────────────────────────────

  public getProtocol(request: ServerRequestData): "http" | "https" {
    // Check proxy headers first
    const forwardedProto = request.headers["x-forwarded-proto"];
    if (forwardedProto) {
      return forwardedProto.toLowerCase() === "https" ? "https" : "http";
    }

    // Cloudflare-specific header
    const cfVisitorHeader = request.headers["cf-visitor"];
    if (cfVisitorHeader) {
      try {
        const parsed = JSON.parse(cfVisitorHeader);
        if (parsed.scheme === "https") return "https";
      } catch {
        // Ignore parse errors
      }
    }

    // Check URL scheme
    if (request.url.protocol === "https:") {
      return "https";
    }

    return "http";
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Language detection
  // ─────────────────────────────────────────────────────────────────────────────

  public getLanguage(request: ServerRequestData): string | undefined {
    const acceptLanguage = request.headers["accept-language"];
    if (!acceptLanguage) return undefined;

    // Parse Accept-Language header
    // Format: "en-US,en;q=0.9,fr;q=0.8"
    const firstLang = acceptLanguage.split(",")[0];
    if (!firstLang) return undefined;

    // Remove quality value if present (e.g., "en;q=0.9" -> "en")
    const lang = firstLang.split(";")[0].trim();

    return lang || undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Referer parsing
  // ─────────────────────────────────────────────────────────────────────────────

  public getReferer(request: ServerRequestData): RequestReferer | undefined {
    const referer = request.headers.referer || request.headers.referrer;
    if (!referer) return undefined;

    try {
      const url = new URL(referer);
      return {
        url: referer,
        hostname: url.hostname,
        pathname: url.pathname,
      };
    } catch {
      // Invalid URL
      return undefined;
    }
  }
}
