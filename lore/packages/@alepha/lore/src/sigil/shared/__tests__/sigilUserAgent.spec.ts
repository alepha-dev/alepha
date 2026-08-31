import { describe, expect, it } from "vitest";

import { sigilUserAgent } from "../sigilUserAgent.ts";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57";
const OPERA_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0";
const FIREFOX_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
const CHROME_OS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("sigilUserAgent", () => {
  it("names the browser family, its major version and the OS", () => {
    expect(sigilUserAgent(CHROME_MAC)).toBe("Chrome 141 on macOS");
    expect(sigilUserAgent(FIREFOX_LINUX)).toBe("Firefox 143 on Linux");
    expect(sigilUserAgent(SAFARI_IPHONE)).toBe("Safari 17 on iOS");
    expect(sigilUserAgent(SAFARI_MAC)).toBe("Safari 26 on macOS");
    expect(sigilUserAgent(CHROME_ANDROID)).toBe("Chrome 120 on Android");
    expect(sigilUserAgent(CHROME_OS)).toBe("Chrome 141 on ChromeOS");
  });

  it("prefers the outermost family, since each one claims to be the next", () => {
    // Edge and Opera both carry a full `Chrome/` token, and every Chromium
    // carries `Safari/`. Reading the first match in source order would report
    // all three as Chrome.
    expect(sigilUserAgent(EDGE_WINDOWS)).toBe("Edge 141 on Windows");
    expect(sigilUserAgent(OPERA_WINDOWS)).toBe("Opera 125 on Windows");
    expect(sigilUserAgent(SAMSUNG)).toBe("Samsung Internet 23 on Android");
  });

  it("prefers Android and ChromeOS over the Linux both of them claim", () => {
    expect(sigilUserAgent(CHROME_ANDROID)).toContain("on Android");
    expect(sigilUserAgent(CHROME_OS)).toContain("on ChromeOS");
  });

  it("drops everything that makes a user agent a fingerprint", () => {
    // Build numbers, device model, engine version and locale all go. What is
    // left is short enough to read and too coarse to tell two visitors apart.
    const reduced = sigilUserAgent(EDGE_WINDOWS);
    expect(reduced).not.toContain("537.36");
    expect(reduced).not.toContain("Win64");
    expect(reduced).not.toContain("3537");
    expect(reduced.length).toBeLessThan(40);
  });

  it("returns an empty string when there is no user agent at all", () => {
    // Empty rather than "Unknown", so the caller omits the field instead of
    // sending a value that says nothing.
    expect(sigilUserAgent(undefined)).toBe("");
    expect(sigilUserAgent("")).toBe("");
    expect(sigilUserAgent("   ")).toBe("");
  });

  it("says Unknown for a user agent it does not recognise", () => {
    // A different fact from "no user agent was sent", and worth telling apart
    // on a single report even though it would be noise as a chart dimension.
    expect(sigilUserAgent("curl/8.4.0")).toBe("Unknown");
  });

  it("names whichever half it does recognise", () => {
    expect(sigilUserAgent("Mozilla/5.0 (Windows NT 10.0) SomeBot/1.0")).toBe(
      "Windows",
    );
  });
});
