import { describe, expect, it } from "vitest";
import {
  sigilAnyGlobMatch,
  telemetryGlobMatch,
} from "../telemetryGlobMatch.ts";

describe("telemetryGlobMatch — sigil excludedPaths matcher (#110)", () => {
  it("exact match", () => {
    expect(telemetryGlobMatch("/contact", "/contact")).toBe(true);
    expect(telemetryGlobMatch("/contact", "/about")).toBe(false);
  });

  it("`*` matches within a segment, not across", () => {
    expect(telemetryGlobMatch("/c/2/request", "/c/*/request")).toBe(true);
    expect(telemetryGlobMatch("/c/123/request", "/c/*/request")).toBe(true);
    expect(telemetryGlobMatch("/c/2/extra/request", "/c/*/request")).toBe(
      false,
    );
  });

  it("`**` matches across segments", () => {
    expect(telemetryGlobMatch("/admin/users/42", "/admin/**")).toBe(true);
    expect(telemetryGlobMatch("/admin", "/admin/**")).toBe(false);
    expect(telemetryGlobMatch("/admin/", "/admin/**")).toBe(true);
  });

  it("anchored at both ends (full-path match)", () => {
    expect(telemetryGlobMatch("/contact-us", "/contact")).toBe(false);
    expect(telemetryGlobMatch("/contact", "contact")).toBe(false);
  });

  it("empty pattern never matches", () => {
    expect(telemetryGlobMatch("/anything", "")).toBe(false);
  });

  it("regex metachars in the pattern are escaped (no bypass)", () => {
    expect(telemetryGlobMatch("/aXb", "/a.b")).toBe(false);
    expect(telemetryGlobMatch("/a.b", "/a.b")).toBe(true);
    expect(telemetryGlobMatch("/foo+bar", "/foo+bar")).toBe(true);
    expect(telemetryGlobMatch("/foobar", "/foo+bar")).toBe(false);
  });

  it("any-of helper: true on first match, false on empty / no match", () => {
    expect(sigilAnyGlobMatch("/admin/users", ["/contact", "/admin/**"])).toBe(
      true,
    );
    expect(sigilAnyGlobMatch("/about", ["/contact", "/admin/**"])).toBe(false);
    expect(sigilAnyGlobMatch("/anywhere", [])).toBe(false);
  });

  it("the quest's documented example: /c/*/request matches the sigil's own page", () => {
    expect(telemetryGlobMatch("/c/2/request", "/c/*/request")).toBe(true);
    expect(telemetryGlobMatch("/c/42/request", "/c/*/request")).toBe(true);
    expect(telemetryGlobMatch("/c/2/q/12", "/c/*/request")).toBe(false);
  });
});
