import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "../helpers/safeRedirectPath.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";

/**
 * `validateRedirectUri` is protected: it is an internal rule, not API. Exposed
 * here so the spec can show that the ONE relative rule below is the rule the
 * provider applies, rather than a second copy that happens to agree today.
 */
class TestServerAuthProvider extends ServerAuthProvider {
  public validate = (uri: string) => this.validateRedirectUri(uri);
}

describe("safeRedirectPath", () => {
  it("keeps a simple absolute path", () => {
    expect(safeRedirectPath("/me")).toBe("/me");
    expect(safeRedirectPath("/admin/pages?x=1")).toBe("/admin/pages?x=1");
  });

  it("rejects protocol-relative, absolute, backslash, and empty → fallback", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("evil")).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(undefined, "/home")).toBe("/home");
  });
});

describe("ServerAuthProvider.validateRedirectUri", () => {
  const boot = async (env: Record<string, string> = {}) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error", ...env } });
    const provider = alepha.inject(TestServerAuthProvider);
    await alepha.start();
    return provider;
  };

  it("applies the same relative rule as safeRedirectPath", async () => {
    const provider = await boot();

    for (const uri of ["/me", "/admin/pages?x=1"]) {
      expect(provider.validate(uri)).toBe(safeRedirectPath(uri));
    }

    // The open-redirect surface, and the reason there must be one rule: the
    // provider used to carry its own copy of these four lines.
    for (const uri of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "evil",
    ]) {
      expect(provider.validate(uri)).toBe("/");
    }
  });

  it("still allows a parent-domain https URL when one is configured", async () => {
    const provider = await boot({ COOKIE_PARENT_DOMAIN: ".example.com" });

    expect(provider.validate("https://tenant.example.com/app")).toBe(
      "https://tenant.example.com/app",
    );
    expect(provider.validate("https://example.com/app")).toBe(
      "https://example.com/app",
    );

    // Neither the wrong host nor the wrong scheme.
    expect(provider.validate("https://evil.com/app")).toBe("/");
    expect(provider.validate("http://tenant.example.com/app")).toBe("/");
    expect(provider.validate("https://notexample.com/app")).toBe("/");
  });
});
