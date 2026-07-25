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
    .default(true),
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

  public getRequestId(request: ServerRequestData): string {
    return request.headers["x-request-id"] || this.cryptoProvider.randomUUID();
  }

  public getRequestUserAgent(request: ServerRequestData) {
    return this.userAgentParser.parse(request.headers["user-agent"]);
  }

  public getRequestIp(request: ServerRequestData): string | undefined {
    // Only trust proxy headers when explicitly configured
    if (this.env.TRUST_PROXY) {
      const headers = request.headers;

      // X-Forwarded-For: standard proxy header (Cloudflare, Vercel, Nginx, etc.)
      const forwardedFor = headers["x-forwarded-for"];
      if (forwardedFor) {
        return Array.isArray(forwardedFor)
          ? forwardedFor[0]
          : forwardedFor.split(",")[0].trim();
      }

      // X-Real-IP: alternative proxy header
      const xRealIP = headers["x-real-ip"];
      if (xRealIP) {
        return Array.isArray(xRealIP) ? xRealIP[0] : xRealIP;
      }
    }

    // Default: use raw connection IP
    return this.getConnectionIp(request);
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
