import { describe, it } from "vitest";
import type { Cookie } from "../primitives/$cookie.ts";
import { CookieParser } from "../services/CookieParser.ts";

const parser = new CookieParser();

describe("CookieParser", () => {
  describe("parseRequestCookies", () => {
    it("should parse simple cookies", ({ expect }) => {
      const result = parser.parseRequestCookies("foo=bar; baz=qux");

      expect(result).toEqual({ foo: "bar", baz: "qux" });
    });

    it("should parse a single cookie", ({ expect }) => {
      const result = parser.parseRequestCookies("foo=bar");

      expect(result).toEqual({ foo: "bar" });
    });

    it("should preserve base64 values with trailing =", ({ expect }) => {
      const result = parser.parseRequestCookies(
        "session=eyJhbGciOiJIUzI1NiJ9==",
      );

      expect(result).toEqual({ session: "eyJhbGciOiJIUzI1NiJ9==" });
    });

    it("should preserve values with multiple = signs", ({ expect }) => {
      const result = parser.parseRequestCookies("token=a=b=c");

      expect(result).toEqual({ token: "a=b=c" });
    });

    it("should handle realistic JWT cookie", ({ expect }) => {
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const result = parser.parseRequestCookies(`auth=${jwt}; theme=dark`);

      expect(result).toEqual({ auth: jwt, theme: "dark" });
    });

    it("should skip parts without = sign", ({ expect }) => {
      const result = parser.parseRequestCookies("foo=bar; invalid; baz=qux");

      expect(result).toEqual({ foo: "bar", baz: "qux" });
    });

    it("should skip entries with empty key or value", ({ expect }) => {
      const result = parser.parseRequestCookies("=bar; foo=; valid=ok");

      expect(result).toEqual({ valid: "ok" });
    });

    it("should trim whitespace from keys and values", ({ expect }) => {
      const result = parser.parseRequestCookies(
        "  foo  =  bar  ;  baz  =  qux  ",
      );

      expect(result).toEqual({ foo: "bar", baz: "qux" });
    });

    it("should return empty object for empty string", ({ expect }) => {
      const result = parser.parseRequestCookies("");

      expect(result).toEqual({});
    });
  });

  describe("serializeResponseCookies", () => {
    it("should serialize cookies to Set-Cookie headers", ({ expect }) => {
      const cookies: Record<string, Cookie | null> = {
        session: { value: "abc123", path: "/", httpOnly: true },
      };

      const result = parser.serializeResponseCookies(cookies, false);

      expect(result).toEqual(["session=abc123; Path=/; HttpOnly"]);
    });

    it("should delete cookies by setting Max-Age=0 when value is null", ({
      expect,
    }) => {
      const cookies: Record<string, Cookie | null> = {
        session: null,
      };

      const result = parser.serializeResponseCookies(cookies, false);

      expect(result).toEqual(["session=; Path=/; Max-Age=0"]);
    });

    it("should skip cookies with empty value", ({ expect }) => {
      const cookies: Record<string, Cookie | null> = {
        empty: { value: "" },
        valid: { value: "ok" },
      };

      const result = parser.serializeResponseCookies(cookies, false);

      expect(result).toEqual(["valid=ok"]);
    });

    it("should add Secure flag when isHttps is true", ({ expect }) => {
      const cookies: Record<string, Cookie | null> = {
        token: { value: "xyz" },
      };

      const result = parser.serializeResponseCookies(cookies, true);

      expect(result).toEqual(["token=xyz; Secure"]);
    });

    it("should not add Secure flag when secure is explicitly false", ({
      expect,
    }) => {
      const cookies: Record<string, Cookie | null> = {
        token: { value: "xyz", secure: false },
      };

      const result = parser.serializeResponseCookies(cookies, true);

      expect(result).toEqual(["token=xyz"]);
    });
  });

  describe("cookieToString", () => {
    it("should serialize cookie with all options", ({ expect }) => {
      const cookie: Cookie = {
        value: "abc",
        path: "/app",
        maxAge: 3600,
        httpOnly: true,
        sameSite: "strict",
        domain: "example.com",
      };

      const result = parser.cookieToString("session", cookie, true);

      expect(result).toBe(
        "session=abc; Path=/app; Max-Age=3600; Secure; HttpOnly; SameSite=strict; Domain=example.com",
      );
    });

    it("should serialize cookie with only value", ({ expect }) => {
      const result = parser.cookieToString("simple", { value: "test" });

      expect(result).toBe("simple=test");
    });
  });
});
