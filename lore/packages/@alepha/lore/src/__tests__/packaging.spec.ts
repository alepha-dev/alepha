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

    expect(cli.AlephaLoreCli).toBeDefined();
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
   * No runtime dependency at all: `alepha` is an optional peer, and the bin
   * carries its own (#Q2579).
   *
   * The reporter, the client and the `lore()` adapter run inside a host app
   * and must use the host's `alepha`, never a second copy, so they take it as
   * a peer. The `lore` bin has no host: `npm i -g "@alepha/lore"` installs
   * into a directory with nothing else in it, and npm, Yarn and pnpm answer a
   * peer differently there. So its build inlines `alepha` and imports nothing
   * but `node:` builtins, which `scripts/check-bin.ts` refuses to let slip.
   *
   * That is also what lets every consumer take this package from npm whatever
   * `alepha` it runs, a vendored one included: the bin never reads it.
   */
  it("has no runtime dependency", () => {
    expect(manifest.dependencies).toBeUndefined();
  });

  /**
   * A caret, the range the sibling `@alepha/*` packages declare as a peer, and
   * optional, so a global install of the bin is never asked for it.
   */
  it("takes alepha as an optional peer, by caret", () => {
    expect(manifest.peerDependencies.alepha).toMatch(/^\^/);
    expect(manifest.peerDependenciesMeta.alepha.optional).toBe(true);
  });

  it("inlines alepha into the bin build only", () => {
    const config = readFileSync(
      new URL("../../tsdown.config.ts", import.meta.url),
      "utf8",
    );

    expect(config).toContain("alwaysBundle: [/^alepha(\\/|$)/");
    expect(config.match(/alwaysBundle/g)).toHaveLength(1);
  });

  /**
   * `./cli` types itself against Lore's own controllers, type-only, through a
   * declared subpath of `apps/lore`. That workspace once declared no `exports`
   * at all, so a deep import into it resolved only by undeclared legacy file
   * resolution: it worked, until the day it did not, with nothing in either
   * manifest saying it was supposed to.
   *
   * The dependency is an OPTIONAL peer, not a devDependency. A `workspace:*`
   * devDependency made the package uninstallable anywhere there is no `lore`
   * workspace: a project vendoring it failed `yarn install` before running
   * anything. An optional peer still says the relationship out loud, the
   * monorepo satisfies it through its workspace link, and a consumer without
   * the Lore app is never asked for it.
   */
  it("type-imports Lore's controllers through a declared subpath", () => {
    const lore = JSON.parse(
      readFileSync(
        new URL("../../../../../apps/lore/package.json", import.meta.url),
        "utf8",
      ),
    );

    expect(manifest.devDependencies.lore).toBeUndefined();
    expect(manifest.peerDependencies.lore).toBe("*");
    expect(manifest.peerDependenciesMeta.lore).toEqual({ optional: true });
    expect(lore.exports["./api/controllers/*"]).toBe(
      "./src/api/controllers/*.ts",
    );
  });

  /**
   * The controllers that left `apps/lore` for an `@lore/*` package (#E75) are
   * typed through that package's `./api`, under the same optional peer: the
   * monorepo satisfies it through its workspace link, and a consumer without
   * Lore is never asked for it.
   */
  it("type-imports a moved controller through its package's ./api", () => {
    const core = JSON.parse(
      readFileSync(
        new URL("../../../../@lore/core/package.json", import.meta.url),
        "utf8",
      ),
    );

    expect(manifest.peerDependencies["@lore/core"]).toBe("*");
    expect(manifest.peerDependenciesMeta["@lore/core"]).toEqual({
      optional: true,
    });
    expect(core.private).toBe(true);
    expect(core.exports["./api"]).toBe("./src/api/index.ts");
  });
});
