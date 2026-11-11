import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { AssetWalker } from "../services/AssetWalker.ts";

/**
 * The one answer to "which files of a build are its assets" (#Q3378), shared
 * by `alepha pack`, a laptop Cloudflare deploy and Lore's pushed asset list.
 */
describe("AssetWalker", () => {
  const setup = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      fs: alepha.inject(MemoryFileSystemProvider),
      walker: alepha.inject(AssetWalker),
    };
  };

  it("lists every file, relative and sorted, without the excluded ones", async ({
    expect,
  }) => {
    const { fs, walker } = setup();
    for (const path of [
      "index.html",
      "assets/app.js",
      "assets/app.js.map",
      ".DS_Store",
      "assets/._app.js",
      "node_modules/x/index.js",
      "deep/e2e/spec.js",
      "coverage/index.html",
      "docs/coverage.html",
    ]) {
      await fs.writeFile(`/dist/public/${path}`, "x");
    }

    expect(await walker.walk("/dist/public")).toEqual([
      "assets/app.js",
      "docs/coverage.html",
      "index.html",
    ]);
  });

  it("matches a pattern against one segment at any depth, as tar does", ({
    expect,
  }) => {
    const { walker } = setup();

    expect(walker.isExcluded("a/b/c.js.map")).toBe(true);
    expect(walker.isExcluded("a/node_modules/b.js")).toBe(true);
    expect(walker.isExcluded("e2e")).toBe(true);
    // A segment only CONTAINING a pattern's text is not a match.
    expect(walker.isExcluded("my-e2e-notes.html")).toBe(false);
    expect(walker.isExcluded("map.js")).toBe(false);
    expect(walker.isExcluded("a\\b.map")).toBe(true);
  });

  it("answers no files for a root that does not exist", async ({ expect }) => {
    const { walker } = setup();

    expect(await walker.walk("/nowhere")).toEqual([]);
  });

  it("is the list alepha pack hands to tar", ({ expect }) => {
    expect(AssetWalker.EXCLUDES).toContain("*.map");
    expect(AssetWalker.EXCLUDES).toContain("node_modules");
  });
});
