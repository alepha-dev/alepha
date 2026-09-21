import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { BuildCommand } from "../build.ts";

/**
 * Exposes the protected runtime resolver for unit testing.
 *
 * ⚠️ There is no `resolveTarget` and no `resolveCompile` any more. `--compile`
 * left `buildOptions` for `alepha compile`, which is what let `--target` stop
 * being constrained by it, and `--target` then had nothing left to say: the
 * build is described by what it produces.
 */
class TestBuildCommand extends BuildCommand {
  public testResolveRuntimes = this.resolveRuntimes.bind(this);
}

describe("BuildCommand", () => {
  const createCommand = () => {
    const alepha = Alepha.create();
    return alepha.inject(TestBuildCommand);
  };

  describe("resolveRuntimes", () => {
    /**
     * ⚠️ Cloudflare is no longer a target that forces a runtime: declaring a
     * workerd slice is what asks for a Worker, and that is the whole of it.
     * The old `--target=cloudflare` said the same thing twice, and could only
     * ever mean one slice, which is what made it impossible to express a
     * `node,workerd` build.
     */
    it("takes workerd as an ordinary declaration", () => {
      expect(createCommand().testResolveRuntimes("workerd")).toEqual([
        "workerd",
      ]);
      expect(createCommand().testResolveRuntimes(["node", "workerd"])).toEqual([
        "node",
        "workerd",
      ]);
    });

    // node alone: the universal floor. workerd is Cloudflare-only and bun is an
    // optimization, so neither belongs in a default every app pays for.
    it("defaults to node when nothing is declared", () => {
      expect(createCommand().testResolveRuntimes(undefined)).toEqual(["node"]);
    });

    /**
     * ⚠️ A static app declares `runtime: ["static"]` and gets NO slices. The
     * old spelling was `--target=static`; the build is described by what it
     * produces, and this one produces no server.
     */
    it("resolves a static declaration to no slices at all", () => {
      expect(createCommand().testResolveRuntimes("static")).toEqual([]);
    });

    it("widens a scalar declaration to a one-slice list", () => {
      expect(createCommand().testResolveRuntimes("bun")).toEqual(["bun"]);
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
      expect(cmd.testResolveRuntimes(["node", "workerd"])).toEqual([
        "node",
        "workerd",
      ]);
      expect(cmd.testResolveRuntimes(["bun", "node"])).toEqual(["bun", "node"]);
    });

    // Keeping the FIRST occurrence: a duplicate further down must not be able
    // to move the primary.
    it("drops a repeat without moving the primary", () => {
      expect(
        createCommand().testResolveRuntimes(["node", "workerd", "node"]),
      ).toEqual(["node", "workerd"]);
    });
  });
});
