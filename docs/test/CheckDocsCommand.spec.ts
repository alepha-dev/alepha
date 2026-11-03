import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { CheckDocsCommand } from "../scripts/check-docs.ts";

class TestCheckDocsCommand extends CheckDocsCommand {
  public testUnstagedOutputs = this.unstagedOutputs.bind(this);
  public testDanglingLinks = this.danglingLinks.bind(this);
}

describe("CheckDocsCommand", () => {
  const boot = () => {
    const alepha = Alepha.create().with({
      provide: ShellProvider,
      use: MemoryShellProvider,
    });
    return {
      check: alepha.inject(TestCheckDocsCommand),
      shell: alepha.inject(MemoryShellProvider),
    };
  };

  const paths = ["docs/2-reference", "packages/alepha/README.md"];
  const diff = `git diff --name-status --no-renames -z -- ${paths.join(" ")}`;
  const untracked = `git ls-files --others --exclude-standard -z -- ${paths.join(" ")}`;

  describe("unstagedOutputs", () => {
    it("should pass when every generated file matches the index", async () => {
      const { check, shell } = boot();

      const problems = await check.testUnstagedOutputs("/repo", paths);

      expect(problems).toEqual([]);
      // Scoped to the generator's outputs: an unstaged edit anywhere else is
      // the author's work in progress, and none of this check's business.
      expect(shell.wasCalled(diff)).toBe(true);
      expect(shell.wasCalled(untracked)).toBe(true);
      expect(shell.calls.every((call) => call.options.root === "/repo")).toBe(
        true,
      );
    });

    it("should refuse a regenerated or removed page that is not staged", async () => {
      const { check, shell } = boot();
      shell.outputs.set(
        diff,
        [
          "M",
          "docs/2-reference/1-primitives/$page.md",
          "D",
          "docs/2-reference/1-primitives/$gone.md",
          "M",
          "packages/alepha/README.md",
          "",
        ].join("\0"),
      );

      const problems = await check.testUnstagedOutputs("/repo", paths);

      expect(problems).toEqual([
        {
          path: "docs/2-reference/1-primitives/$page.md",
          message:
            "docs/2-reference/1-primitives/$page.md - generated, and differs from what is staged",
        },
        {
          path: "docs/2-reference/1-primitives/$gone.md",
          message:
            "docs/2-reference/1-primitives/$gone.md - no longer generated, and its deletion is not staged",
        },
        {
          path: "packages/alepha/README.md",
          message:
            "packages/alepha/README.md - generated, and differs from what is staged",
        },
      ]);
    });

    it("should refuse a page the generator writes for the first time", async () => {
      // #Q2357: an export made the generator emit `$pageNav.md`, and the page
      // existed in CI only. Untracked is how that page looks in a checkout
      // that has just run `yarn copy`.
      const { check, shell } = boot();
      shell.outputs.set(
        untracked,
        "docs/2-reference/1-primitives/$pageNav.md\0",
      );

      const problems = await check.testUnstagedOutputs("/repo", paths);

      expect(problems).toEqual([
        {
          path: "docs/2-reference/1-primitives/$pageNav.md",
          message:
            "docs/2-reference/1-primitives/$pageNav.md - generated, and not added to git",
        },
      ]);
    });
  });

  describe("danglingLinks", () => {
    const index = new Map([
      [":guides-core", new Set(["top"])],
      ["lore:guides-x", new Set<string>()],
    ]);

    it("should accept a link to an existing page and heading", () => {
      const { check } = boot();
      const md = [
        "# Page",
        "[a](/docs/guides-core#top) [b](https://alepha.dev/lore/docs/guides-x.md) [c](#page)",
      ].join("\n");

      expect(check.testDanglingLinks("a.md", md, index)).toEqual([]);
    });

    it("should refuse a missing page, a missing heading and a missing anchor", () => {
      const { check } = boot();
      const md = [
        "# Page",
        "[a](/docs/guides-gone) [b](/docs/guides-core#gone)",
        "[c](/bay/docs/guides-core) [d](#gone)",
      ].join("\n");

      expect(check.testDanglingLinks("a.md", md, index)).toEqual([
        "a.md:2 - /docs/guides-gone is linked but no page generates it",
        "a.md:2 - /docs/guides-core#gone is linked but that page has no such heading",
        "a.md:3 - /bay/docs/guides-core is linked but no page generates it",
        "a.md:3 - #gone is linked but this page has no such heading",
      ]);
    });
  });
});
