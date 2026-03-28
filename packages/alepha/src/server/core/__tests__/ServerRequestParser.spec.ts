import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { CryptoProvider } from "../../../crypto/index.ts";
import type { ServerRequestData } from "../interfaces/ServerRequest.ts";
import { ServerRequestParser } from "../services/ServerRequestParser.ts";

const createMockRequestData = (
  headers: Record<string, string> = {},
): ServerRequestData =>
  ({
    method: "GET",
    url: new URL("https://example.com/test"),
    headers,
    query: {},
    params: {},
    raw: { node: undefined, web: undefined },
  }) as ServerRequestData;

describe("ServerRequestParser", () => {
  describe("getRequestIp", () => {
    it("should use X-Forwarded-For when TRUST_PROXY is true", ({ expect }) => {
      const alepha = Alepha.create({ env: { TRUST_PROXY: "true" } });
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
      });

      expect(parser.getRequestIp(request)).toBe("203.0.113.195");
    });

    it("should use first IP from X-Forwarded-For chain", ({ expect }) => {
      const alepha = Alepha.create({ env: { TRUST_PROXY: "true" } });
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "x-forwarded-for": "192.168.1.1, 10.0.0.1",
      });

      expect(parser.getRequestIp(request)).toBe("192.168.1.1");
    });

    it("should use X-Real-IP as fallback", ({ expect }) => {
      const alepha = Alepha.create({ env: { TRUST_PROXY: "true" } });
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "x-real-ip": "192.168.1.100",
      });

      expect(parser.getRequestIp(request)).toBe("192.168.1.100");
    });

    it("should ignore proxy headers when TRUST_PROXY is false", ({
      expect,
    }) => {
      const alepha = Alepha.create({ env: { TRUST_PROXY: "false" } });
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "x-forwarded-for": "203.0.113.195",
        "x-real-ip": "192.168.1.100",
      });

      // Should return undefined since no raw connection IP
      expect(parser.getRequestIp(request)).toBe(undefined);
    });
  });

  describe("getRequestGeo", () => {
    it("should parse Cloudflare geo headers", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "cf-ipcountry": "US",
        "cf-ipcity": "San Francisco",
        "cf-region": "California",
        "cf-iplatitude": "37.7749",
        "cf-iplongitude": "-122.4194",
      });

      const geo = parser.getRequestGeo(request);
      expect(geo.country).toBe("US");
      expect(geo.city).toBe("San Francisco");
      expect(geo.region).toBe("California");
      expect(geo.latitude).toBe("37.7749");
      expect(geo.longitude).toBe("-122.4194");
    });

    it("should parse Vercel geo headers", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "x-vercel-ip-country": "FR",
        "x-vercel-ip-city": "Paris",
        "x-vercel-ip-country-region": "IDF",
        "x-vercel-ip-latitude": "48.8566",
        "x-vercel-ip-longitude": "2.3522",
      });

      const geo = parser.getRequestGeo(request);
      expect(geo.country).toBe("FR");
      expect(geo.city).toBe("Paris");
      expect(geo.region).toBe("IDF");
      expect(geo.latitude).toBe("48.8566");
      expect(geo.longitude).toBe("2.3522");
    });

    it("should parse AWS CloudFront geo headers", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "cloudfront-viewer-country": "JP",
      });

      const geo = parser.getRequestGeo(request);
      expect(geo.country).toBe("JP");
    });

    it("should return empty geo for missing headers", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({});

      const geo = parser.getRequestGeo(request);
      expect(geo.country).toBe(undefined);
      expect(geo.city).toBe(undefined);
      expect(geo.region).toBe(undefined);
      expect(geo.latitude).toBe(undefined);
      expect(geo.longitude).toBe(undefined);
    });
  });

  describe("getIsBot", () => {
    it("should detect Googlebot", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      });

      expect(parser.getIsBot(request)).toBe(true);
    });

    it("should detect Bingbot", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      });

      expect(parser.getIsBot(request)).toBe(true);
    });

    it("should detect curl", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent": "curl/7.68.0",
      });

      expect(parser.getIsBot(request)).toBe(true);
    });

    it("should detect Python requests", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent": "python-requests/2.25.1",
      });

      expect(parser.getIsBot(request)).toBe(true);
    });

    it("should detect HeadlessChrome", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/91.0.4472.114 Safari/537.36",
      });

      expect(parser.getIsBot(request)).toBe(true);
    });

    it("should detect GPTBot", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)",
      });

      expect(parser.getIsBot(request)).toBe(true);
    });

    it("should detect ClaudeBot", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent": "ClaudeBot/1.0",
      });

      expect(parser.getIsBot(request)).toBe(true);
    });

    it("should not detect regular browser as bot", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      });

      expect(parser.getIsBot(request)).toBe(false);
    });

    it("should return false for missing user-agent", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({});

      expect(parser.getIsBot(request)).toBe(false);
    });
  });

  describe("getIsMobile", () => {
    it("should detect Android device", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36",
      });

      expect(parser.getIsMobile(request)).toBe(true);
    });

    it("should detect iPhone", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1",
      });

      expect(parser.getIsMobile(request)).toBe(true);
    });

    it("should detect iPad", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1",
      });

      expect(parser.getIsMobile(request)).toBe(true);
    });

    it("should detect Windows Phone", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.15254",
      });

      expect(parser.getIsMobile(request)).toBe(true);
    });

    it("should not detect desktop as mobile", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      });

      expect(parser.getIsMobile(request)).toBe(false);
    });

    it("should return false for missing user-agent", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({});

      expect(parser.getIsMobile(request)).toBe(false);
    });
  });

  describe("getProtocol", () => {
    it("should use X-Forwarded-Proto header", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "x-forwarded-proto": "https",
      });

      expect(parser.getProtocol(request)).toBe("https");
    });

    it("should handle HTTP from X-Forwarded-Proto", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "x-forwarded-proto": "http",
      });

      expect(parser.getProtocol(request)).toBe("http");
    });

    it("should parse Cloudflare CF-Visitor header", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "cf-visitor": '{"scheme":"https"}',
      });

      expect(parser.getProtocol(request)).toBe("https");
    });

    it("should handle invalid CF-Visitor JSON gracefully", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "cf-visitor": "invalid-json",
      });

      // Should fall back to URL scheme (http since mock URL is https)
      expect(parser.getProtocol(request)).toBe("https");
    });

    it("should use URL scheme as fallback", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({});

      // Our mock URL is https://example.com/test
      expect(parser.getProtocol(request)).toBe("https");
    });

    it("should default to http when URL is http", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = {
        ...createMockRequestData({}),
        url: new URL("http://example.com/test"),
      };

      expect(parser.getProtocol(request)).toBe("http");
    });
  });

  describe("getLanguage", () => {
    it("should parse simple Accept-Language", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "accept-language": "en-US",
      });

      expect(parser.getLanguage(request)).toBe("en-US");
    });

    it("should return first language from list", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "accept-language": "en-US,en;q=0.9,fr;q=0.8",
      });

      expect(parser.getLanguage(request)).toBe("en-US");
    });

    it("should handle quality values", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "accept-language": "fr;q=0.9,en;q=0.8",
      });

      expect(parser.getLanguage(request)).toBe("fr");
    });

    it("should return undefined for missing header", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({});

      expect(parser.getLanguage(request)).toBe(undefined);
    });

    it("should handle complex Accept-Language", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      });

      expect(parser.getLanguage(request)).toBe("zh-CN");
    });
  });

  describe("getReferer", () => {
    it("should parse valid referer URL", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        referer: "https://google.com/search?q=test",
      });

      const referer = parser.getReferer(request);
      expect(referer?.url).toBe("https://google.com/search?q=test");
      expect(referer?.hostname).toBe("google.com");
      expect(referer?.pathname).toBe("/search");
    });

    it("should handle referrer header (alternative spelling)", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        referrer: "https://example.org/page",
      });

      const referer = parser.getReferer(request);
      expect(referer?.url).toBe("https://example.org/page");
      expect(referer?.hostname).toBe("example.org");
      expect(referer?.pathname).toBe("/page");
    });

    it("should prefer referer over referrer", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        referer: "https://first.com/",
        referrer: "https://second.com/",
      });

      const referer = parser.getReferer(request);
      expect(referer?.hostname).toBe("first.com");
    });

    it("should return undefined for missing header", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({});

      expect(parser.getReferer(request)).toBe(undefined);
    });

    it("should return undefined for invalid URL", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        referer: "not-a-valid-url",
      });

      expect(parser.getReferer(request)).toBe(undefined);
    });
  });

  describe("getRequestId", () => {
    it("should extract X-Request-ID header", ({ expect }) => {
      const alepha = Alepha.create();
      const parser = alepha.inject(ServerRequestParser);

      const request = createMockRequestData({
        "x-request-id": "abc-123-def",
      });

      expect(parser.getRequestId(request)).toBe("abc-123-def");
    });

    it("should return UUID for missing header", ({ expect }) => {
      const reqId = "00000000-0000-0000-0000-000000000000";
      const alepha = Alepha.create().with({
        provide: CryptoProvider,
        use: class extends CryptoProvider {
          randomUUID() {
            return reqId;
          }
        },
      });
      const parser = alepha.inject(ServerRequestParser);
      const request = createMockRequestData({});

      expect(parser.getRequestId(request)).toBe(reqId);
    });
  });
});
