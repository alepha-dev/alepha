import { describe, expect, it } from "vitest";
import { sigilCampaign } from "../sigilCampaign.ts";

describe("sigilCampaign", () => {
  it("reads utm_campaign", () => {
    expect(sigilCampaign("?utm_campaign=launch")).toBe("launch");
  });

  it("falls back to utm_source when there is no campaign", () => {
    // Both are how links actually get tagged; insisting on one would silently
    // drop half of them.
    expect(sigilCampaign("?utm_source=hn")).toBe("hn");
  });

  it("prefers utm_campaign when both are present", () => {
    expect(sigilCampaign("?utm_source=hn&utm_campaign=launch")).toBe("launch");
  });

  it("lowercases so one tag is one row", () => {
    expect(sigilCampaign("?utm_source=HN")).toBe("hn");
  });

  it("returns undefined when there is no tag", () => {
    expect(sigilCampaign("")).toBeUndefined();
    expect(sigilCampaign("?q=search+terms")).toBeUndefined();
    expect(sigilCampaign("?utm_source=")).toBeUndefined();
  });

  it("ignores unrelated query parameters entirely", () => {
    // The rest of the query string is not this function's business, and in
    // particular never reaches a dimension.
    expect(sigilCampaign("?token=secret&utm_source=hn&email=a@b.c")).toBe("hn");
  });

  it("caps the value so a hostile query cannot mint unbounded rows", () => {
    expect(sigilCampaign(`?utm_source=${"x".repeat(500)}`)).toHaveLength(64);
  });
});
