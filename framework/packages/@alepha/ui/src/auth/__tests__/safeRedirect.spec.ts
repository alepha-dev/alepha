import { describe, expect, it } from "vitest";

import { safeRedirect } from "../safeRedirect.ts";

/**
 * The client half of the open-redirect rule. `router.push` takes a pathname,
 * so a bad value here is not an off-site navigation by itself; it follows the
 * server's `safeRedirectPath` anyway, for the pre-hydration links that are
 * plain hrefs.
 */
describe("safeRedirect", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirect("/projects?tab=1")).toBe("/projects?tab=1");
  });

  it("refuses protocol-relative, absolute, backslash and auth paths", () => {
    for (const raw of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "/auth/login",
    ]) {
      expect(safeRedirect(raw)).toBe("/");
    }
  });

  it("refuses a tab, CR, LF or other control character", () => {
    for (const raw of [
      "/\t/evil.example",
      "/\r/evil.example",
      "/\n/evil.example",
      "/\u0000/evil.example",
      decodeURIComponent("%2F%09%2Fevil.example"),
    ]) {
      expect(safeRedirect(raw)).toBe("/");
    }
  });
});
