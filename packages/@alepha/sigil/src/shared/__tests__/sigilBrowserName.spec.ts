import { describe, it } from "vitest";

import { sigilBrowserName } from "../sigilBrowserName.ts";

/**
 * Real user-agent strings, because the whole implementation is an ORDER and
 * the order only matters against strings that nest. Every one of these was
 * taken from a live agent rather than composed to pass.
 */
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1";
const FIREFOX_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15";

describe("sigilBrowserName", () => {
  it("names the four it knows", ({ expect }) => {
    expect(sigilBrowserName(CHROME)).toBe("chrome");
    expect(sigilBrowserName(EDGE)).toBe("edge");
    expect(sigilBrowserName(SAFARI)).toBe("safari");
    expect(sigilBrowserName(FIREFOX)).toBe("firefox");
  });

  /**
   * The three cases the order exists for. Every Chromium browser claims to be
   * Chrome and Chrome claims to be Safari, so a naive test collapses all of
   * them into one bucket.
   */
  it("does not let a nested claim win", ({ expect }) => {
    // Sends `Chrome/` too.
    expect(sigilBrowserName(EDGE)).not.toBe("chrome");
    // Sends `Safari/` too.
    expect(sigilBrowserName(CHROME)).not.toBe("safari");
    // Sends `Safari/` AND is not Chrome.
    expect(sigilBrowserName(SAFARI)).toBe("safari");
  });

  it("names an iOS browser by its brand, not by its engine", ({ expect }) => {
    // Both run WebKit on iOS and both send `Safari/`. They are still Chrome
    // and Firefox to everyone who has to support them.
    expect(sigilBrowserName(CHROME_IOS)).toBe("chrome");
    expect(sigilBrowserName(FIREFOX_IOS)).toBe("firefox");
  });

  it("answers other for an absent or unrecognised agent", ({ expect }) => {
    expect(sigilBrowserName(undefined)).toBe("other");
    expect(sigilBrowserName("")).toBe("other");
    expect(sigilBrowserName("curl/8.7.1")).toBe("other");
    expect(sigilBrowserName("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(
      "other",
    );
  });
});
