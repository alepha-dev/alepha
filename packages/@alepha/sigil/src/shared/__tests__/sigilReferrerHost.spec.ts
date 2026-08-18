import { describe, expect, it } from "vitest";
import { sigilReferrerHost } from "../sigilReferrerHost.ts";

const SELF = "https://alepha.dev";

describe("sigilReferrerHost", () => {
  it("returns the bare host of a cross-origin referrer", () => {
    expect(
      sigilReferrerHost("https://news.ycombinator.com/item?id=1", SELF),
    ).toBe("news.ycombinator.com");
  });

  it("drops the path and query, which describe a third-party page", () => {
    expect(
      sigilReferrerHost("https://www.google.com/search?q=secret+terms", SELF),
    ).toBe("www.google.com");
  });

  it("drops a same-origin referrer so the app never tops its own chart", () => {
    expect(
      sigilReferrerHost("https://alepha.dev/docs/guides", SELF),
    ).toBeUndefined();
  });

  it("keeps a different host on the same registrable domain", () => {
    // Not the same origin, so it is a real referral between two deployments.
    expect(sigilReferrerHost("https://lore.alepha.dev/x", SELF)).toBe(
      "lore.alepha.dev",
    );
  });

  it("treats a different scheme on the same host as cross-origin", () => {
    expect(sigilReferrerHost("http://alepha.dev/x", SELF)).toBe("alepha.dev");
  });

  it("returns undefined for an absent or empty referrer", () => {
    expect(sigilReferrerHost(undefined, SELF)).toBeUndefined();
    expect(sigilReferrerHost("", SELF)).toBeUndefined();
  });

  it("returns undefined for a value that is not a parseable URL", () => {
    expect(sigilReferrerHost("/relative/path", SELF)).toBeUndefined();
    expect(sigilReferrerHost("about:blank", SELF)).toBeUndefined();
  });

  it("lowercases the host so one site is one row", () => {
    expect(sigilReferrerHost("https://News.YCombinator.com/", SELF)).toBe(
      "news.ycombinator.com",
    );
  });

  it("keeps the port, which distinguishes two local deployments", () => {
    expect(sigilReferrerHost("http://localhost:3000/a", SELF)).toBe(
      "localhost:3000",
    );
  });
});
