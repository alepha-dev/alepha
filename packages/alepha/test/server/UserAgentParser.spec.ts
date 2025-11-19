import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { UserAgentParser } from "../../src/server/services/UserAgentParser.ts";

describe("UserAgentParser", () => {
  const alepha = Alepha.create();
  const parser = alepha.inject(UserAgentParser);

  it("should parse Windows user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";
    const result = parser.parse(ua);
    expect(result.os).toBe("Windows");
    expect(result.browser).toBe("Chrome");
    expect(result.device).toBe("DESKTOP");

    const ua2 =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36";
    const result2 = parser.parse(ua2);
    expect(result2.os).toBe("Windows");
    expect(result2.browser).toBe("Chrome");
    expect(result2.device).toBe("DESKTOP");

    const firefoxUa =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:80.0) Gecko/20100101 Firefox/80.0";
    const firefoxResult = parser.parse(firefoxUa);
    expect(firefoxResult.os).toBe("Windows");
    expect(firefoxResult.browser).toBe("Firefox");
    expect(firefoxResult.device).toBe("DESKTOP");
  });

  it("should parse Android user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 MOBILE Safari/537.36";
    const result = parser.parse(ua);
    expect(result.os).toBe("Android");
    expect(result.browser).toBe("Chrome");
    expect(result.device).toBe("MOBILE");
  });

  it("should parse iOS user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 MOBILE/15E148 Safari/604.1";
    const result = parser.parse(ua);
    expect(result.os).toBe("iOS");
    expect(result.browser).toBe("Safari");
    expect(result.device).toBe("MOBILE");
  });

  it("should parse MacOS user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15";
    const result = parser.parse(ua);
    expect(result.os).toBe("MacOS");
    expect(result.browser).toBe("Safari");
    expect(result.device).toBe("DESKTOP");
  });

  it("should parse Linux user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36";
    const result = parser.parse(ua);
    expect(result.os).toBe("Linux");
    expect(result.browser).toBe("Chrome");
    expect(result.device).toBe("DESKTOP");
  });

  it("should parse FreeBSD user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (X11; FreeBSD amd64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36";
    const result = parser.parse(ua);
    expect(result.os).toBe("FreeBSD");
    expect(result.browser).toBe("Chrome");
    expect(result.device).toBe("DESKTOP");
  });

  it("should parse OpenBSD user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (X11; OpenBSD amd64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36";
    const result = parser.parse(ua);
    expect(result.os).toBe("OpenBSD");
    expect(result.browser).toBe("Chrome");
    expect(result.device).toBe("DESKTOP");
  });

  it("should parse ChromeOS user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (X11; CrOS x86_64 12345.67.89) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36";
    const result = parser.parse(ua);
    expect(result.os).toBe("ChromeOS");
    expect(result.browser).toBe("Chrome");
    expect(result.device).toBe("DESKTOP");
  });

  it("should parse BlackBerry user agent", ({ expect }) => {
    const ua =
      "Mozilla/5.0 (BB10; Touch) AppleWebKit/537.36 (KHTML, like Gecko) Version/10.3.2.2876 MOBILE Safari/537.36";
    const result = parser.parse(ua);
    expect(result.os).toBe("BlackBerry");
    expect(result.browser).toBe("Safari");
    expect(result.device).toBe("MOBILE");
  });

  it("should parse empty string", ({ expect }) => {
    const ua = "";
    const result = parser.parse(ua);
    expect(result.os).toBe("Windows");
    expect(result.browser).toBe("Chrome");
    expect(result.device).toBe("DESKTOP");
  });
});
