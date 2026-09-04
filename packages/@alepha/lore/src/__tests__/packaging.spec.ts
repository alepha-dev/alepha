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
   * Exactly one runtime dependency, and it is `alepha`.
   *
   * This used to assert none at all, which was right while both halves were
   * imported by a host that already had `alepha` and could satisfy a peer.
   * The `lore` bin has no host: `npm i -g "@alepha/lore"` installs into a
   * directory with nothing else in it, npm 7+ would auto-install the peer,
   * Yarn would not and pnpm differs again, and a tool people are told to
   * install globally cannot depend on which manager they used.
   *
   * The list stays closed, because everything else the CLI needs is still
   * reached through the container: file and git work go through
   * `FileSystemProvider` and `ShellProvider`, not through a tar or a git
   * library, and a production app installing this package for the reporter
   * half pays for none of it.
   */
  it("depends on alepha at runtime, and on nothing else", () => {
    expect(Object.keys(manifest.dependencies)).toEqual(["alepha"]);
  });

  /**
   * A caret rather than an exact pin, and the same range all eight sibling
   * `@alepha/*` packages declare. It dedupes with a sigil consumer's own
   * `alepha` anywhere in `0.28.x` instead of guaranteeing a second copy, and
   * `release.yml` keeps it current for free: `yarn workspaces foreach version`
   * rewrites inter-workspace ranges in `dependencies` exactly as it already
   * does in `peerDependencies`.
   */
  it("takes alepha by caret, and no longer as a peer", () => {
    expect(manifest.dependencies.alepha).toMatch(/^\^/);
    expect(manifest.peerDependencies.alepha).toBeUndefined();
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
