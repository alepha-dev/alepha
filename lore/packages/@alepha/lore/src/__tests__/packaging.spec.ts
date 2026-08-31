import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The manifest is the public API of a package, and it is the one part of it
 * that no test would otherwise touch.
 *
 * This package carries two halves that are used by entirely different hosts:
 * `./sigil` is imported by a browser app, `./cli` by a CI runner. The shapes
 * below are what keeps one from paying for the other, and every one of them
 * fails silently rather than loudly when it drifts, which is why they are
 * asserted here rather than left to review.
 */
describe("@alepha/lore packaging", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );

  it("is named @alepha/lore", () => {
    expect(manifest.name).toBe("@alepha/lore");
  });

  it("exports ./sigil behind a browser condition", () => {
    const sigil = manifest.exports["./sigil"];

    expect(sigil).toBeDefined();
    expect(sigil.browser).toBeDefined();
    expect(sigil.types).toBeDefined();
  });

  /**
   * A bundler that resolves `./cli` has wandered somewhere it does not belong.
   * With no `browser` condition it fails loudly on the first `node:` import
   * rather than being handed a stub that returns undefined at runtime.
   */
  it("exports ./cli with no browser condition", () => {
    const cli = manifest.exports["./cli"];

    expect(cli).toBeDefined();
    expect(cli.browser).toBeUndefined();
  });

  it("resolves ./cli through the exports map", async () => {
    const cli = await import("@alepha/lore/cli");

    expect(cli.AlephaLoreCliPlugin).toBeDefined();
  });

  it("publishes both subpaths from dist", () => {
    const published = manifest.publishConfig.exports;

    expect(published["./sigil"].types).toMatch(/^\.\/dist\//);
    expect(published["./cli"].types).toMatch(/^\.\/dist\//);
    expect(published["./cli"].browser).toBeUndefined();
  });

  /**
   * A CI runner installing this package for `./cli` alone must not be told it
   * needs React.
   */
  it("marks react and react-dom as optional peers", () => {
    expect(manifest.peerDependencies.react).toBeDefined();
    expect(manifest.peerDependenciesMeta.react.optional).toBe(true);
    expect(manifest.peerDependenciesMeta["react-dom"].optional).toBe(true);
  });

  /**
   * Zero runtime dependencies today, and worth protecting: production apps
   * install this package for the reporter half. File and git work in the CLI
   * goes through `FileSystemProvider` and `ShellProvider` for the same reason.
   */
  it("has no runtime dependencies", () => {
    expect(manifest.dependencies).toBeUndefined();
  });

  /**
   * `./cli` types itself against Lore's own controllers through a type-only
   * devDependency on `apps/lore`. That workspace declared no `exports` at all,
   * so a deep import into it resolved only by undeclared legacy file
   * resolution: it worked, until the day it did not, with nothing in either
   * manifest saying it was supposed to.
   */
  it("type-imports Lore's controllers through a declared subpath", () => {
    const lore = JSON.parse(
      readFileSync(
        new URL("../../../../../apps/lore/package.json", import.meta.url),
        "utf8",
      ),
    );

    expect(manifest.devDependencies.lore).toBe("workspace:*");
    expect(lore.exports["./api/controllers/*"]).toBe(
      "./src/api/controllers/*.ts",
    );
  });
});
