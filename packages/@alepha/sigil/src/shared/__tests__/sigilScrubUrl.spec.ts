import { describe, expect, it } from "vitest";

import { sigilScrubUrl } from "../sigilScrubUrl.ts";

describe("sigilScrubUrl", () => {
  it("drops the query string, which is where the tokens are", () => {
    expect(
      sigilScrubUrl("https://app.example.com/auth/reset-password?token=abc123"),
    ).toBe("https://app.example.com/auth/reset-password");
  });

  it("drops the fragment, which is where implicit-flow tokens are", () => {
    expect(
      sigilScrubUrl("https://app.example.com/callback#access_token=abc123"),
    ).toBe("https://app.example.com/callback");
  });

  it("drops both when both are present, and keeps nothing after the first", () => {
    expect(sigilScrubUrl("https://app/x?a=1#b=2")).toBe("https://app/x");
    expect(sigilScrubUrl("https://app/x#b=2?a=1")).toBe("https://app/x");
  });

  it("strips userinfo credentials from the origin", () => {
    expect(sigilScrubUrl("https://user:pass@app.example.com/x")).toBe(
      "https://app.example.com/x",
    );
  });

  it("leaves a clean url, a route pattern and a job source untouched", () => {
    expect(sigilScrubUrl("https://app.example.com/pricing")).toBe(
      "https://app.example.com/pricing",
    );
    // What SigilServerErrors passes: a route pattern, not a resolved path.
    expect(sigilScrubUrl("/users/:id")).toBe("/users/:id");
    expect(sigilScrubUrl("job:nightly-sweep")).toBe("job:nightly-sweep");
    expect(sigilScrubUrl("")).toBe("");
  });

  it("caps length at the envelope's own limit", () => {
    expect(sigilScrubUrl(`https://app/${"a".repeat(5000)}`)).toHaveLength(2000);
  });

  it("does not mistake an @ in the path for userinfo", () => {
    expect(sigilScrubUrl("https://app.example.com/@handle")).toBe(
      "https://app.example.com/@handle",
    );
  });
});
