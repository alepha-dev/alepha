import { describe, expect, it } from "vitest";
import { pulseGlobMatch, sigilAnyGlobMatch } from "../pulseGlobMatch.ts";

describe("pulseGlobMatch — sigil excludedPaths matcher (#110)", () => {
  it("exact match", () => {
    expect(pulseGlobMatch("/contact", "/contact")).toBe(true);
    expect(pulseGlobMatch("/contact", "/about")).toBe(false);
  });

  it("`*` matches within a segment, not across", () => {
    expect(pulseGlobMatch("/c/2/request", "/c/*/request")).toBe(true);
    expect(pulseGlobMatch("/c/123/request", "/c/*/request")).toBe(true);
    expect(pulseGlobMatch("/c/2/extra/request", "/c/*/request")).toBe(false);
  });

  it("`**` matches across segments", () => {
    expect(pulseGlobMatch("/admin/users/42", "/admin/**")).toBe(true);
    expect(pulseGlobMatch("/admin", "/admin/**")).toBe(false);
    expect(pulseGlobMatch("/admin/", "/admin/**")).toBe(true);
  });

  it("anchored at both ends (full-path match)", () => {
    expect(pulseGlobMatch("/contact-us", "/contact")).toBe(false);
    expect(pulseGlobMatch("/contact", "contact")).toBe(false);
  });

  it("empty pattern never matches", () => {
    expect(pulseGlobMatch("/anything", "")).toBe(false);
  });

  it("regex metachars in the pattern are escaped (no bypass)", () => {
    expect(pulseGlobMatch("/aXb", "/a.b")).toBe(false);
    expect(pulseGlobMatch("/a.b", "/a.b")).toBe(true);
    expect(pulseGlobMatch("/foo+bar", "/foo+bar")).toBe(true);
    expect(pulseGlobMatch("/foobar", "/foo+bar")).toBe(false);
  });

  it("any-of helper: true on first match, false on empty / no match", () => {
    expect(sigilAnyGlobMatch("/admin/users", ["/contact", "/admin/**"])).toBe(
      true,
    );
    expect(sigilAnyGlobMatch("/about", ["/contact", "/admin/**"])).toBe(false);
    expect(sigilAnyGlobMatch("/anywhere", [])).toBe(false);
  });

  it("the quest's documented example: /c/*/request matches the sigil's own page", () => {
    expect(pulseGlobMatch("/c/2/request", "/c/*/request")).toBe(true);
    expect(pulseGlobMatch("/c/42/request", "/c/*/request")).toBe(true);
    expect(pulseGlobMatch("/c/2/q/12", "/c/*/request")).toBe(false);
  });
});
