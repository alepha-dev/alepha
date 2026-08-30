import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { LogRedaction } from "../services/LogRedaction.ts";

/**
 * The single list two log paths share. It exists because there used to be
 * two: `ServerLoggerProvider` redacted query keys and `HttpClient` redacted
 * header names, each blind to the other, which left `HttpClient` logging its
 * URL and its request body verbatim. A login body with a plaintext password
 * was a larger leak than the header that had just been closed.
 */
describe("LogRedaction", () => {
  const redaction = () => Alepha.create().inject(LogRedaction);

  describe("query", () => {
    it("replaces credential values and keeps their keys", ({ expect }) => {
      // The key is most of what the line is for: knowing an OAuth callback
      // carried a `code` is useful, knowing which code is a live credential.
      expect(redaction().query("?code=live-auth-code&state=csrf")).toBe(
        "?code=[redacted]&state=[redacted]",
      );
    });

    it("rebuilds nothing when the query is ordinary", ({ expect }) => {
      // Byte for byte as it arrived, encoding included.
      expect(redaction().query("?redirect=%2Fhome&page=2")).toBe(
        "?redirect=%2Fhome&page=2",
      );
    });

    it("gives back the form it was handed", ({ expect }) => {
      expect(redaction().query("token=x")).toBe("token=[redacted]");
      expect(redaction().query("")).toBe("");
    });

    it("folds case and separators, so one entry covers every spelling", ({
      expect,
    }) => {
      // The whole reason the set is stored normalized. Three spellings of
      // one thing used to need three entries, and the third was always the
      // one nobody added.
      expect(redaction().query("?access_token=a")).toBe(
        "?access_token=[redacted]",
      );
      expect(redaction().query("?accessToken=a")).toBe(
        "?accessToken=[redacted]",
      );
      expect(redaction().query("?ACCESS-TOKEN=a")).toBe(
        "?ACCESS-TOKEN=[redacted]",
      );
    });
  });

  describe("path", () => {
    it("keeps the pathname and redacts the query", ({ expect }) => {
      expect(
        redaction().path(new URL("https://x.dev/oauth/cb?code=live&next=/a")),
      ).toBe("/oauth/cb?code=[redacted]&next=%2Fa");
    });

    it("returns the bare pathname when there is no query", ({ expect }) => {
      expect(redaction().path(new URL("https://x.dev/a/b"))).toBe("/a/b");
    });
  });

  describe("url", () => {
    it("handles a relative URL the same as an absolute one", ({ expect }) => {
      // `HttpClient` is handed both, so this splits on `?` rather than
      // parsing: a relative URL has no origin for `new URL` to work with.
      expect(redaction().url("/api/x?token=abc&a=1")).toBe(
        "/api/x?token=[redacted]&a=1",
      );
      expect(redaction().url("https://x.dev/api?apiKey=abc")).toBe(
        "https://x.dev/api?apiKey=[redacted]",
      );
    });

    it("leaves a URL with no query exactly as it was", ({ expect }) => {
      expect(redaction().url("https://x.dev/api/users")).toBe(
        "https://x.dev/api/users",
      );
    });

    it("keeps a fragment out of the query it rebuilds", ({ expect }) => {
      expect(redaction().url("/a?secret=s#frag")).toBe(
        "/a?secret=[redacted]#frag",
      );
    });
  });

  describe("body", () => {
    it("redacts credential fields of a plain object", ({ expect }) => {
      // The leak the header fix left open: this is a login body.
      expect(
        redaction().body({ email: "a@b.dev", password: "hunter2" }),
      ).toEqual({ email: "a@b.dev", password: "[redacted]" });
    });

    it("walks nested objects and arrays", ({ expect }) => {
      expect(
        redaction().body({
          user: { name: "jo", apiKey: "k" },
          grants: [{ refresh_token: "r" }],
        }),
      ).toEqual({
        user: { name: "jo", apiKey: "[redacted]" },
        grants: [{ refresh_token: "[redacted]" }],
      });
    });

    it("parses and redacts a JSON string body", ({ expect }) => {
      // What `HttpClient` actually holds by the time it traces: the body has
      // already been serialised.
      expect(redaction().body('{"password":"hunter2","keep":1}')).toEqual({
        password: "[redacted]",
        keep: 1,
      });
    });

    it("describes a string that is not structured JSON", ({ expect }) => {
      // A form-encoded body could hide a password anywhere in it, so its
      // content never reaches the line.
      expect(redaction().body("user=a&password=hunter2")).toEqual({
        type: "string",
        size: 23,
      });
    });

    it("describes a binary body by type and size", ({ expect }) => {
      expect(redaction().body(new Uint8Array(64))).toEqual({
        type: "Uint8Array",
        size: 64,
      });
      expect(redaction().body(new ArrayBuffer(8))).toEqual({
        type: "ArrayBuffer",
        size: 8,
      });
    });

    it("describes a FormData by its entry count", ({ expect }) => {
      const form = new FormData();
      form.set("a", "1");
      form.set("password", "hunter2");
      expect(redaction().body(form)).toEqual({ type: "FormData", size: 2 });
    });

    it("describes a stream with no size, rather than consuming it", ({
      expect,
    }) => {
      const stream = new ReadableStream();
      const described = redaction().body(stream) as { size?: number };
      expect(described.size).toBeUndefined();
      // Reading it to measure it would destroy the request being logged.
      expect(stream.locked).toBe(false);
    });

    it("leaves an absent body alone", ({ expect }) => {
      expect(redaction().body(undefined)).toBeUndefined();
      expect(redaction().body(null)).toBeNull();
    });

    it("stops walking a deeply nested body", ({ expect }) => {
      // An unbounded walk over an attacker-shaped body is work done on the
      // logging path. A credential is near the top in every real payload.
      let deep: Record<string, unknown> = { password: "x" };
      for (let i = 0; i < 8; i++) {
        deep = { nest: deep };
      }
      expect(JSON.stringify(redaction().body(deep))).toContain("[truncated]");
    });
  });
});
