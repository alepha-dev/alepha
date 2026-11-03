import { describe, expect, it } from "vitest";

import { DocsMarkdown } from "../scripts/DocsMarkdown.ts";

describe("DocsMarkdown", () => {
  describe("slug", () => {
    it("should join the category and the file, without order prefixes", () => {
      expect(DocsMarkdown.slug("1-guides/3-core", "2-configurations.md")).toBe(
        "guides-core-configurations",
      );
      expect(DocsMarkdown.slug("", "1-introduction.md")).toBe(
        "root-introduction",
      );
    });
  });

  describe("headingIds", () => {
    it("should follow GitHub's rule, and number repeated headings", () => {
      const ids = DocsMarkdown.headingIds(
        [
          "# Title",
          "## Folds: sum, min, max and last",
          "## Example",
          "```ts",
          "## not a heading",
          "```",
          "## Example",
        ].join("\n"),
      );

      expect([...ids]).toEqual([
        "title",
        "folds-sum-min-max-and-last",
        "example",
        "example-1",
      ]);
    });
  });

  describe("description", () => {
    it("should take the first prose paragraph, past the import section", () => {
      const md = [
        "# $env",
        "",
        "## Import",
        "",
        "```ts",
        'import { $env } from "alepha";',
        "```",
        "",
        "## Overview",
        "",
        "Reads **typed** [environment](/docs/x) variables. Fails at boot.",
      ].join("\n");

      expect(DocsMarkdown.description(md)).toBe(
        "Reads typed environment variables. Fails at boot.",
      );
    });

    it("should not end on a colon that announced a code block", () => {
      const md = [
        "# Page",
        "",
        "Alepha reads the env once. Declare a schema like this:",
        "",
        "```ts",
        "```",
      ].join("\n");

      expect(DocsMarkdown.description(md)).toBe("Alepha reads the env once.");
    });

    it("should keep the text of code spans as written", () => {
      expect(
        DocsMarkdown.plain("Tables `_raw` and `_<tier>`, _emphasis_."),
      ).toBe("Tables _raw and _<tier>, emphasis.");
    });
  });

  describe("docLinks", () => {
    it("should read the product, slug and anchor, outside fences", () => {
      const md = [
        "See [a](/docs/guides-core#top) and [b](https://alepha.dev/lore/docs/guides-x.md).",
        "```md",
        "[c](/docs/ignored)",
        "```",
        '[d](/bay/docs/root-bay "Bay")',
      ].join("\n");

      expect(DocsMarkdown.docLinks(md)).toEqual([
        { product: "", slug: "guides-core", anchor: "top", line: 1 },
        { product: "lore", slug: "guides-x", anchor: undefined, line: 1 },
        { product: "bay", slug: "root-bay", anchor: undefined, line: 5 },
      ]);
    });
  });

  describe("forAgents", () => {
    it("should point doc links at the absolute markdown copy", () => {
      expect(
        DocsMarkdown.forAgents(
          "[a](/docs/guides-core#top) [b](/lore/docs/guides-x) [c](https://example.com)",
        ),
      ).toBe(
        "[a](https://alepha.dev/docs/guides-core.md#top) [b](https://alepha.dev/lore/docs/guides-x.md) [c](https://example.com)",
      );
    });

    it("should take the check marker out of fence info strings", () => {
      expect(DocsMarkdown.forAgents("```ts check\nconst a = 1;\n```")).toBe(
        "```ts\nconst a = 1;\n```",
      );
    });
  });

  describe("forSite", () => {
    it("should point the site's own links at the site being built", () => {
      expect(
        DocsMarkdown.forSite(
          "[a](https://alepha.dev/llms.txt) [b](https://lore.alepha.dev) [c](https://alepha.dev.example.com)",
          "https://latest.alepha.dev",
        ),
      ).toBe(
        "[a](https://latest.alepha.dev/llms.txt) [b](https://lore.alepha.dev) [c](https://alepha.dev.example.com)",
      );
    });
  });
});
