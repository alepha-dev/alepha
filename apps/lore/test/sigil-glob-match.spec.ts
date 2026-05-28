import { describe, expect, it } from "vitest";
import {
  sigilAnyGlobMatch,
  sigilGlobMatch,
} from "../src/api/services/sigilGlobMatch.ts";

describe("sigilGlobMatch — sigil excludedPaths matcher (#110)", () => {
  it("exact match", () => {
    expect(sigilGlobMatch("/contact", "/contact")).toBe(true);
    expect(sigilGlobMatch("/contact", "/about")).toBe(false);
  });

  it("`*` matches within a segment, not across", () => {
    expect(sigilGlobMatch("/c/2/request", "/c/*/request")).toBe(true);
    expect(sigilGlobMatch("/c/123/request", "/c/*/request")).toBe(true);
    expect(sigilGlobMatch("/c/2/extra/request", "/c/*/request")).toBe(false);
  });

  it("`**` matches across segments", () => {
    expect(sigilGlobMatch("/admin/users/42", "/admin/**")).toBe(true);
    expect(sigilGlobMatch("/admin", "/admin/**")).toBe(false);
    expect(sigilGlobMatch("/admin/", "/admin/**")).toBe(true);
  });

  it("anchored at both ends (full-path match)", () => {
    expect(sigilGlobMatch("/contact-us", "/contact")).toBe(false);
    expect(sigilGlobMatch("/contact", "contact")).toBe(false);
  });

  it("empty pattern never matches", () => {
    expect(sigilGlobMatch("/anything", "")).toBe(false);
  });

  it("regex metachars in the pattern are escaped (no bypass)", () => {
    expect(sigilGlobMatch("/aXb", "/a.b")).toBe(false);
    expect(sigilGlobMatch("/a.b", "/a.b")).toBe(true);
    expect(sigilGlobMatch("/foo+bar", "/foo+bar")).toBe(true);
    expect(sigilGlobMatch("/foobar", "/foo+bar")).toBe(false);
  });

  it("any-of helper: true on first match, false on empty / no match", () => {
    expect(sigilAnyGlobMatch("/admin/users", ["/contact", "/admin/**"])).toBe(
      true,
    );
    expect(sigilAnyGlobMatch("/about", ["/contact", "/admin/**"])).toBe(false);
    expect(sigilAnyGlobMatch("/anywhere", [])).toBe(false);
  });

  it("the quest's documented example: /c/*/request matches the sigil's own page", () => {
    expect(sigilGlobMatch("/c/2/request", "/c/*/request")).toBe(true);
    expect(sigilGlobMatch("/c/42/request", "/c/*/request")).toBe(true);
    expect(sigilGlobMatch("/c/2/q/12", "/c/*/request")).toBe(false);
  });
});
