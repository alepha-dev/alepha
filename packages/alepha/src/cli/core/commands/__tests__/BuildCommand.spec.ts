import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { BuildCommand } from "../build.ts";

/**
 * Exposes the protected target/runtime resolvers for unit testing.
 */
class TestBuildCommand extends BuildCommand {
  public testResolveTarget = this.resolveTarget.bind(this);
  public testResolveRuntimes = this.resolveRuntimes.bind(this);
  public testResolveCompile = this.resolveCompile.bind(this);
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

  describe("resolveCompile", () => {
    it("is off when neither the flag nor the config asks for it", () => {
      expect(
        createCommand().testResolveCompile(undefined, undefined, "bare", "bun"),
      ).toBeUndefined();
    });

    it("names the binary 'app' for a bare --compile", () => {
      expect(
        createCommand().testResolveCompile(true, undefined, "bare", "bun"),
      ).toEqual({ name: "app", minify: true });
    });

    it("takes the binary name from --compile <name>", () => {
      expect(
        createCommand().testResolveCompile("loom", undefined, undefined, "bun"),
      ).toEqual({ name: "loom", minify: true });
    });

    it("takes the name, target and minify from the config", () => {
      expect(
        createCommand().testResolveCompile(
          undefined,
          { name: "loom", target: "bun-linux-arm64-musl", minify: false },
          "docker",
          "bun",
        ),
      ).toEqual({
        name: "loom",
        target: "bun-linux-arm64-musl",
        minify: false,
      });
      expect(
        createCommand().testResolveCompile(undefined, "loom", "bare", "bun"),
      ).toEqual({ name: "loom", minify: true });
    });

    it("lets a flag name override the config name and keep the rest", () => {
      expect(
        createCommand().testResolveCompile(
          "api",
          { name: "loom", target: "bun-linux-arm64-musl", minify: false },
          "bare",
          "bun",
        ),
      ).toEqual({ name: "api", target: "bun-linux-arm64-musl", minify: false });
    });

    it("lets an explicit flag beat the config either way", () => {
      const cmd = createCommand();
      expect(cmd.testResolveCompile(false, "loom", "bare", "bun")).toBe(
        undefined,
      );
      expect(cmd.testResolveCompile(true, false, "bare", "bun")).toEqual({
        name: "app",
        minify: true,
      });
    });

    /**
     * The parser hands a boolean-or-text flag its raw text, so `--compile=false`
     * arrives as the string "false", which is also a valid file name.
     */
    it("reads --compile=false as off, not as a binary named 'false'", () => {
      const cmd = createCommand();
      expect(cmd.testResolveCompile("false", "loom", "bare", "bun")).toBe(
        undefined,
      );
      expect(cmd.testResolveCompile("true", undefined, "bare", "bun")).toEqual({
        name: "app",
        minify: true,
      });
    });

    it("refuses a binary name that is not a plain file name", () => {
      const cmd = createCommand();
      for (const name of ["../evil", "my app", "Loom", "-x", ""]) {
        expect(() =>
          cmd.testResolveCompile(name, undefined, "bare", "bun"),
        ).toThrow(/binary name/);
      }
    });

    it("refuses any runtime but bun, and says which flag to add", () => {
      expect(() =>
        createCommand().testResolveCompile(true, undefined, "bare", "node"),
      ).toThrow(/--runtime=bun/);
    });

    it("refuses a target that cannot hold a binary", () => {
      const cmd = createCommand();
      expect(() =>
        cmd.testResolveCompile(true, undefined, "cloudflare", "bun"),
      ).toThrow(/only 'bare' and 'docker'/);
      expect(() =>
        cmd.testResolveCompile(true, undefined, "static", "bun"),
      ).toThrow(/only 'bare' and 'docker'/);
    });
  });
});
