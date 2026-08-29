import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { UserAgentParser } from "../index.ts";

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

  /**
   * A header that says nothing must be reported as saying nothing. These
   * used to be attributed to "Chrome on Windows" by the parser's defaults,
   * so every API client, MCP agent and header-less probe appeared on the
   * account sessions page as a Windows desktop browser that never existed.
   */
  it("should report an absent user agent as unknown", ({ expect }) => {
    for (const ua of ["", undefined]) {
      const result = parser.parse(ua);
      expect(result.os).toBe("Unknown");
      expect(result.browser).toBe("Unknown");
      expect(result.device).toBe("UNKNOWN");
    }
  });

  it("should report an unrecognised user agent as unknown", ({ expect }) => {
    for (const ua of [
      "curl/8.4.0",
      "python-requests/2.31.0",
      "node",
      "Claude-User/1.0",
    ]) {
      const result = parser.parse(ua);
      expect(result.os).toBe("Unknown");
      expect(result.browser).toBe("Unknown");
      expect(result.device).toBe("UNKNOWN");
    }
  });

  /**
   * DESKTOP stays an inference drawn from a recognised UA, not a fallback:
   * a real browser that names neither a phone nor a tablet is a desktop.
   */
  it("should still infer DESKTOP from a recognised desktop user agent", ({
    expect,
  }) => {
    const result = parser.parse(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    expect(result.os).toBe("Linux");
    expect(result.browser).toBe("Chrome");
    expect(result.device).toBe("DESKTOP");
  });

  /**
   * The cases below are the ones the parser used to get wrong. Each is a
   * real user agent, and each failed for a structural reason rather than a
   * missing keyword, so they are kept together as a table: the branch order
   * they pin down is the thing that regresses, not the individual strings.
   */
  describe("clients the parser used to misread", () => {
    const cases: Array<{
      name: string;
      ua: string;
      os: string;
      browser: string;
      device: string;
    }> = [
      {
        // Every iOS engine is WebKit and appends "Safari/60x", so the old
        // "safari and not chrome" test claimed this one.
        name: "Chrome for iOS",
        ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1",
        os: "iOS",
        browser: "Chrome",
        device: "MOBILE",
      },
      {
        name: "Firefox for iOS",
        ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15",
        os: "iOS",
        browser: "Firefox",
        device: "MOBILE",
      },
      {
        // The counterpart to the two above: moving Safari to the last
        // branch must not stop real Safari being recognised.
        name: "Safari for iOS",
        ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
        os: "iOS",
        browser: "Safari",
        device: "MOBILE",
      },
      {
        name: "Safari on macOS",
        ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
        os: "MacOS",
        browser: "Safari",
        device: "DESKTOP",
      },
      {
        // No "Mobile" token, so this is a tablet by Android's own rule.
        name: "Chrome on an Android tablet",
        ua: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        os: "Android",
        browser: "Chrome",
        device: "TABLET",
      },
      {
        name: "Chrome on an Android phone",
        ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        os: "Android",
        browser: "Chrome",
        device: "MOBILE",
      },
      {
        // The model name says Samsung; the browser does not.
        name: "Chrome on a Samsung phone",
        ua: "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        os: "Android",
        browser: "Chrome",
        device: "MOBILE",
      },
      {
        name: "Samsung Internet",
        ua: "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
        os: "Android",
        browser: "Samsung Browser",
        device: "MOBILE",
      },
      {
        name: "Edge on Android",
        ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0",
        os: "Android",
        browser: "Edge",
        device: "MOBILE",
      },
      {
        name: "Edge on Windows",
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
        os: "Windows",
        browser: "Edge",
        device: "DESKTOP",
      },
      {
        name: "Opera on Windows",
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/117.0.0.0",
        os: "Windows",
        browser: "Opera",
        device: "DESKTOP",
      },
      {
        // A crawler names neither an OS nor an engine, and must not be
        // dressed up as a desktop browser on the sessions page.
        name: "Googlebot",
        ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        os: "Unknown",
        browser: "Unknown",
        device: "UNKNOWN",
      },
    ];

    for (const c of cases) {
      it(`should parse ${c.name}`, ({ expect }) => {
        const result = parser.parse(c.ua);
        expect({
          os: result.os,
          browser: result.browser,
          device: result.device,
        }).toEqual({ os: c.os, browser: c.browser, device: c.device });
      });
    }
  });
});
