import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
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

  it("rejects a control character a browser would strip into //host", () => {
    for (const uri of [
      "/\t/evil.example",
      "/\r/evil.example",
      "/\n/evil.example",
      "/\r\n/evil.example",
      "/\u0000/evil.example",
      "/\u007f/evil.example",
      "/me\t",
    ]) {
      expect(safeRedirectPath(uri)).toBe("/");
    }
  });

  it("rejects the decoded form of a percent-encoded control character", () => {
    // What a query string like `?redirect_uri=%2F%09%2Fevil.example` becomes
    // once the server has decoded it.
    expect(safeRedirectPath(decodeURIComponent("%2F%09%2Fevil.example"))).toBe(
      "/",
    );
    expect(safeRedirectPath(decodeURIComponent("%2F%0D%0A%2Fevil"))).toBe("/");
  });

  it("keeps a still-encoded control character, which stays on the origin", () => {
    // A browser does not decode `%09` in a Location before resolving it, so
    // this is a same-origin path with an odd segment, not a way off-site.
    expect(safeRedirectPath("/%09/evil.example")).toBe("/%09/evil.example");
  });
});

describe("the logout route's post_logout_redirect_uri", () => {
  const logout = async (target: string) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(ServerAuthProvider);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;
    const response = await fetch(
      `${hostname}/oauth/logout?post_logout_redirect_uri=${encodeURIComponent(target)}`,
      { method: "POST", redirect: "manual" },
    );
    await alepha.stop();
    return response.headers.get("location");
  };

  it("sends a tab, CR or LF variant home instead of off-site", async () => {
    for (const target of [
      "/\t/evil.example",
      "/\r/evil.example",
      "/\n/evil.example",
    ]) {
      expect(await logout(target)).toBe("/");
    }
  });

  it("keeps a plain in-app path", async () => {
    expect(await logout("/projects")).toBe("/projects");
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

    // The login route stores what this returns: a control character is
    // refused on both branches, relative and parent-domain.
    expect(provider.validate("/\t/evil.example")).toBe("/");
    expect(provider.validate("https://tenant.example.com/\n")).toBe("/");
  });
});
