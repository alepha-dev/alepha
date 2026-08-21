import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { BuildCommand } from "../build.ts";

/**
 * Exposes the protected target/runtime resolvers for unit testing.
 */
class TestBuildCommand extends BuildCommand {
  public testResolveTarget = this.resolveTarget.bind(this);
  public testResolveRuntime = this.resolveRuntime.bind(this);
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

  describe("resolveRuntime", () => {
    it("forces workerd for the canonicalized cloudflare target", () => {
      const cmd = createCommand();
      const target = cmd.testResolveTarget("cf");
      expect(cmd.testResolveRuntime(target, undefined)).toBe("workerd");
    });
  });
});
