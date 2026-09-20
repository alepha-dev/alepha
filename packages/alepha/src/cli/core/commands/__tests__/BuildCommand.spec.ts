import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { BuildCommand } from "../build.ts";

/**
 * Exposes the protected target/runtime resolvers for unit testing.
 *
 * ⚠️ There is no `resolveCompile` any more: `--compile` left `buildOptions`
 * for `alepha compile`, its own command reading `./dist`, which is what let
 * `--target` stop being constrained by it.
 */
class TestBuildCommand extends BuildCommand {
  public testResolveTarget = this.resolveTarget.bind(this);
  public testResolveRuntimes = this.resolveRuntimes.bind(this);
}

describe("BuildCommand", () => {
  const createCommand = () => {
    const alepha = Alepha.create();
    return alepha.inject(TestBuildCommand);
  };

  describe("resolveTarget", () => {
    it("maps the 'cf' alias to 'cloudflare'", () => {
      expect(createCommand().testResolveTarget("cf")).toBe("cloudflare");
    });

    it("passes canonical targets through unchanged", () => {
      const cmd = createCommand();
      expect(cmd.testResolveTarget("cloudflare")).toBe("cloudflare");
      expect(cmd.testResolveTarget("docker")).toBe("docker");
      expect(cmd.testResolveTarget("bare")).toBe("bare");
    });

    it("returns undefined when no target is given", () => {
      expect(createCommand().testResolveTarget(undefined)).toBeUndefined();
    });
  });

  describe("resolveRuntimes", () => {
    it("forces workerd for the canonicalized cloudflare target", () => {
      const cmd = createCommand();
      const target = cmd.testResolveTarget("cf");
      expect(cmd.testResolveRuntimes(target, undefined)).toEqual(["workerd"]);
    });

    it("refuses a cloudflare target asked for anything but workerd", () => {
      const cmd = createCommand();
      expect(() => cmd.testResolveRuntimes("cloudflare", ["node"])).toThrow(
        /workerd/,
      );
    });

    // node alone: the universal floor. workerd is Cloudflare-only and bun is an
    // optimization, so neither belongs in a default every app pays for.
    it("defaults to node when nothing is declared", () => {
      expect(createCommand().testResolveRuntimes(undefined, undefined)).toEqual(
        ["node"],
      );
    });

    it("widens a scalar declaration to a one-slice list", () => {
      expect(createCommand().testResolveRuntimes("bare", "bun")).toEqual([
        "bun",
      ]);
    });

    /**
     * ⚠️ The whole contract in one case. The same two runtimes declared the
     * other way round must come back the other way round, because the first is
     * the primary: it is `manifest.runtime`, it is `dist/package.json`'s `main`,
     * and it is what a deployer spawns. A sort here would make the two
     * indistinguishable.
     */
    it("preserves declared order, and never sorts it", () => {
      const cmd = createCommand();
      expect(cmd.testResolveRuntimes("bare", ["node", "workerd"])).toEqual([
        "node",
        "workerd",
      ]);
      expect(cmd.testResolveRuntimes("bare", ["bun", "node"])).toEqual([
        "bun",
        "node",
      ]);
    });

    // Keeping the FIRST occurrence: a duplicate further down must not be able
    // to move the primary.
    it("drops a repeat without moving the primary", () => {
      expect(
        createCommand().testResolveRuntimes("bare", [
          "node",
          "workerd",
          "node",
        ]),
      ).toEqual(["node", "workerd"]);
    });
  });
});
