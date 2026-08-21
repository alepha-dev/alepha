import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { DocsChecker } from "../scripts/DocsChecker.ts";

describe("DocsChecker", () => {
  const boot = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      checker: alepha.inject(DocsChecker),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  describe("parseFences", () => {
    it("should record the language, the marker and the 1-based start line", () => {
      // The line number is what makes a violation actionable - a report that
      // says "somewhere in this file" is a report nobody acts on.
      const { checker } = boot();

      const fences = checker.parseFences(
        [
          "intro",
          "```ts check",
          "const a = 1;",
          "```",
          "",
          "```bash",
          "ls",
          "```",
        ].join("\n"),
      );

      expect(fences).toHaveLength(2);
      expect(fences[0]).toMatchObject({
        lang: "ts",
        checked: true,
        line: 2,
        code: "const a = 1;\n",
      });
      expect(fences[1]).toMatchObject({
        lang: "bash",
        checked: false,
        line: 6,
      });
    });

    it("should treat only the `check` marker as opt-in", () => {
      // Fence meta is also used for line highlighting and filenames
      // (```ts {1,3} filename="x.ts"), so the marker has to be matched as a
      // word, not as a substring of the meta string.
      const { checker } = boot();

      const fences = checker.parseFences(
        [
          "```typescript",
          "a",
          "```",
          '```ts {1,3} filename="checkout.ts"',
          "b",
          "```",
          "```tsx check",
          "c",
          "```",
        ].join("\n"),
      );

      expect(fences.map((f) => f.checked)).toEqual([false, false, true]);
    });

    it("should not treat an indented fence inside a fence as a new block", () => {
      const { checker } = boot();

      const fences = checker.parseFences(
        ["````md", "```ts", "not a real block", "```", "````"].join("\n"),
      );

      expect(fences).toHaveLength(1);
      expect(fences[0].lang).toBe("md");
    });
  });

  describe("findBannedSymbols", () => {
    it("should reject a symbol the framework no longer exports", async () => {
      // The whole reason this check exists: the docs told every AI to
      // `import { t } from "alepha"` for months after `t` was deleted, and
      // nothing anywhere noticed.
      const { checker, fs } = boot();
      await fs.writeFile(
        "/docs/a.md",
        ["```ts", 'import { t } from "alepha";', "```"].join("\n"),
      );

      const violations = await checker.check(["/docs/a.md"]);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: "/docs/a.md", line: 2 });
      expect(violations[0].message).toMatch(/t/);
    });

    it("should flag banned prose as well as code", async () => {
      // "Alepha uses TypeBox" was wrong in a paragraph, not in a fence.
      const { checker, fs } = boot();
      await fs.writeFile("/docs/a.md", "Alepha validates with TypeBox.");

      const violations = await checker.check(["/docs/a.md"]);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toMatch(/TypeBox/);
    });

    it("should allow a banned token when it is part of a longer identifier", async () => {
      // `toTypeBoxSchema` in devtools is an internal name, not a claim about
      // the framework - and `t` appears inside every English sentence.
      const { checker, fs } = boot();
      await fs.writeFile(
        "/docs/a.md",
        "The toTypeBoxSchema helper is internal. It takes the value.",
      );

      const violations = await checker.check(["/docs/a.md"]);

      expect(violations).toEqual([]);
    });

    it("should reject an em dash anywhere in the docs", async () => {
      // docs/ and apps/docs were swept free of em dashes on 2026-08-19; this
      // entry keeps them from creeping back in.
      const { checker, fs } = boot();
      await fs.writeFile(
        "/docs/a.md",
        "Alepha is convention-driven — almost no configuration.",
      );

      const violations = await checker.check(["/docs/a.md"]);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: "/docs/a.md", line: 1 });
      expect(violations[0].message).toMatch(/em dash/);
    });

    it("should not flag a banned word inside a fenced code sample that is quoting history", async () => {
      // An explicit escape hatch, because some docs legitimately describe the
      // old world (migration notes, changelogs).
      const { checker, fs } = boot();
      await fs.writeFile(
        "/docs/a.md",
        [
          "<!-- docs-check-ignore -->",
          "Alepha used TypeBox before v0.20.",
        ].join("\n"),
      );

      const violations = await checker.check(["/docs/a.md"]);

      expect(violations).toEqual([]);
    });

    it("should keep the escape hatch across the blank line a formatter inserts", async () => {
      // `<!-- docs-check-ignore -->` is a block-level HTML comment, so every
      // markdown formatter puts a blank line after it. When the marker only
      // exempted the line immediately below, formatting `docs/` detached every
      // one of them and the check failed on prose nobody had touched.
      const { checker, fs } = boot();
      await fs.writeFile(
        "/docs/a.md",
        [
          "<!-- docs-check-ignore -->",
          "",
          "Alepha used TypeBox before v0.20.",
        ].join("\n"),
      );

      const violations = await checker.check(["/docs/a.md"]);

      expect(violations).toEqual([]);
    });

    it("should not let a marker exempt a line two paragraphs down", async () => {
      const { checker, fs } = boot();
      await fs.writeFile(
        "/docs/a.md",
        [
          "<!-- docs-check-ignore -->",
          "",
          "Alepha used TypeBox before v0.20.",
          "",
          "Alepha used TypeBox before v0.20.",
        ].join("\n"),
      );

      const violations = await checker.check(["/docs/a.md"]);

      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: "/docs/a.md", line: 5 });
    });
  });

  describe("collectCheckedFences", () => {
    it("should return only the opted-in TypeScript fences", async () => {
      const { checker, fs } = boot();
      await fs.writeFile(
        "/docs/a.md",
        [
          "```ts check",
          "export const a = 1;",
          "```",
          "```ts",
          "not compiled",
          "```",
          "```bash check",
          "ls",
          "```",
        ].join("\n"),
      );

      const units = await checker.collectCheckedFences(["/docs/a.md"]);

      expect(units).toHaveLength(1);
      expect(units[0]).toMatchObject({
        file: "/docs/a.md",
        line: 1,
        code: "export const a = 1;\n",
      });
    });
  });
});
