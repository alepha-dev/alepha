import { describe, expect, it } from "vitest";

import { sigilHost } from "../sigilHost.ts";

describe("sigilHost", () => {
  it("keeps an ordinary host", () => {
    expect(sigilHost("alepha.dev")).toBe("alepha.dev");
  });

  it("lowercases, because a Host header may arrive in any case", () => {
    expect(sigilHost("Alepha.DEV")).toBe("alepha.dev");
  });

  it("keeps the port, which is part of the address of a self-hosted app", () => {
    expect(sigilHost("app.internal:8080")).toBe("app.internal:8080");
  });

  it("drops the root label's trailing dot", () => {
    expect(sigilHost("alepha.dev.")).toBe("alepha.dev");
    expect(sigilHost("alepha.dev.:8080")).toBe("alepha.dev:8080");
  });

  it("keeps an IPv6 literal", () => {
    expect(sigilHost("[::1]:8080")).toBe("[::1]:8080");
  });

  it("refuses anything that is not a bare authority", () => {
    // The sink renders this as a link, so a value that is not an authority is
    // worse than no value at all.
    expect(sigilHost("https://alepha.dev")).toBeUndefined();
    expect(sigilHost("alepha.dev/path")).toBeUndefined();
    expect(sigilHost("alepha.dev?q=1")).toBeUndefined();
    expect(sigilHost("alepha.dev evil.dev")).toBeUndefined();
    expect(sigilHost('alepha.dev" onclick="')).toBeUndefined();
  });

  it("refuses empty and absent", () => {
    expect(sigilHost(undefined)).toBeUndefined();
    expect(sigilHost("   ")).toBeUndefined();
  });

  it("refuses an over-long name rather than truncating it", () => {
    // Truncating would not shorten the address, it would name a DIFFERENT one
    // - and that is the one the operator would then be handed as a link.
    expect(sigilHost(`${"a".repeat(254)}.dev`)).toBeUndefined();
  });
});
