import { readFileSync } from "node:fs";

import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import type { HeadersRefusal } from "../interfaces/HeadersFile.ts";
import { HeadersFileReader } from "../services/HeadersFileReader.ts";

/**
 * The conformance fixture Bay's Go reader runs too. It lives in `apps/bay`
 * because Bay's test container sees nothing else.
 */
const fixture = new URL(
  "../../../../../../apps/bay/internal/headers/testdata/",
  import.meta.url,
);

const read = (name: string) => readFileSync(new URL(name, fixture), "utf8");

interface FixtureCase {
  name: string;
  path: string;
  status: number;
  defaults: Record<string, string>;
  expected: Record<string, string>;
}

interface FixtureRefusal {
  name: string;
  file: string;
  problems: Array<{ reason: HeadersRefusal; lines: number[] }>;
}

describe("HeadersFileReader", () => {
  const reader = new HeadersFileReader();

  describe("the conformance fixture", () => {
    const { cases } = JSON.parse(read("cases.json")) as {
      cases: FixtureCase[];
    };
    const { refusals } = JSON.parse(read("refusals.json")) as {
      refusals: FixtureRefusal[];
    };

    it("reads the fixture's _headers with no problem", ({ expect }) => {
      expect(() => reader.read(read("_headers"))).not.toThrow();
    });

    for (const c of cases) {
      it(`applies: ${c.name}`, ({ expect }) => {
        const rules = reader.read(read("_headers"));
        const headers = reader.apply(rules, c.path, { ...c.defaults });
        expect(headers).toEqual(c.expected);
      });
    }

    for (const refusal of refusals) {
      it(`refuses: ${refusal.name}`, ({ expect }) => {
        const { rules, problems } = reader.parse(read(refusal.file));
        const all = [...problems, ...reader.validate(rules)].map((it) => ({
          reason: it.reason,
          lines: it.lines,
        }));
        expect(all).toEqual(refusal.problems);
      });
    }
  });

  describe("parsing", () => {
    it("accepts CRLF line endings and no indentation", ({ expect }) => {
      const rules = reader.read("/a\r\nX-A: 1\r\n! X-B\r\n");

      expect(rules).toEqual([
        {
          path: "/a",
          line: 1,
          unset: [{ name: "X-B", line: 3 }],
          set: [{ name: "X-A", value: "1", line: 2 }],
        },
      ]);
    });

    it("keeps every colon of a value after the first", ({ expect }) => {
      const rules = reader.read(
        "/a\n  Link: <https://example.com>; rel=preconnect\n",
      );

      expect(rules[0].set[0].value).toBe(
        "<https://example.com>; rel=preconnect",
      );
    });

    it("names the file and every line in the error", ({ expect }) => {
      expect(() =>
        reader.read("/a/:id\n  X-A: 1\n/b\n", "public/_headers"),
      ).toThrow(/public\/_headers:1: .*placeholder[\s\S]*public\/_headers:3: /);
    });
  });

  describe("no silent joins", () => {
    it("names both lines and a path both rules match", ({ expect }) => {
      const { rules } = reader.parse(
        "/*.png\n  Cache-Control: a\n/asset.*\n  Cache-Control: b\n",
      );

      expect(reader.validate(rules)).toEqual([
        expect.objectContaining({
          reason: "silent-join",
          lines: [2, 4],
          path: "/asset..png",
        }),
      ]);
    });

    it("accepts the later rule once it removes the header first", ({
      expect,
    }) => {
      const { rules } = reader.parse(
        "/*.png\n  Cache-Control: a\n/asset.*\n  ! cache-control\n  Cache-Control: b\n",
      );

      expect(reader.validate(rules)).toEqual([]);
    });

    it("accepts two rules that set one header when no path matches both", ({
      expect,
    }) => {
      const { rules } = reader.parse(
        "/*.png\n  Cache-Control: a\n/*.svg\n  Cache-Control: b\n/docs/*\n  X-A: 1\n/blog/*\n  X-A: 2\n",
      );

      expect(reader.validate(rules)).toEqual([]);
    });

    it("finds the overlap of a prefix and a suffix pattern", ({ expect }) => {
      const { rules } = reader.parse("/docs/*\n  X-A: 1\n/*.md\n  X-A: 2\n");

      expect(reader.validate(rules)[0]?.path).toBe("/docs/.md");
    });
  });

  describe("matching", () => {
    it("lets * match nothing, and a slash", ({ expect }) => {
      expect(reader.matches("/docs/*", "/docs/")).toBe(true);
      expect(reader.matches("/docs/*", "/docs/a/b")).toBe(true);
      expect(reader.matches("/*.js", "/.js")).toBe(true);
      expect(reader.matches("/a*a", "/a")).toBe(false);
      expect(reader.matches("/a*a", "/aa")).toBe(true);
    });

    it("compares an exact path as received, encoding and all", ({ expect }) => {
      expect(reader.matches("/caf%C3%A9", "/caf%C3%A9")).toBe(true);
      expect(reader.matches("/caf%C3%A9", "/caf%c3%a9")).toBe(false);
      expect(reader.matches("/caf%C3%A9", "/café")).toBe(false);
    });
  });

  describe("applying", () => {
    it("appends a later set of a header an earlier rule set", ({ expect }) => {
      // A file that does this is refused by `validate`, which is exactly why
      // the semantics it would have must still be Cloudflare's.
      const { rules } = reader.parse("/*\n  X-A: 1\n/a\n  X-A: 2\n");

      expect(reader.apply(rules, "/a", {})).toEqual({ "x-a": "1, 2" });
    });

    it("removes a header whatever the case of its key", ({ expect }) => {
      const rules = reader.read("/*\n  ! X-Frame-Options\n");

      expect(
        reader.apply(rules, "/", { "X-Frame-Options": "DENY", vary: "a" }),
      ).toEqual({ vary: "a" });
    });
  });

  it("registers no HTTP server when injected", ({ expect }) => {
    // Declared in no `$module`. The build injects it from the CLI's own
    // container, which must not grow a server for reading a text file.
    const alepha = Alepha.create();

    alepha.inject(HeadersFileReader);

    expect(alepha.has(ServerProvider)).toBe(false);
  });
});
