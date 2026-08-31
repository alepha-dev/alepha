import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { loreOptions } from "../atoms/loreOptions.ts";
import { LoreClientService } from "../services/LoreClientService.ts";

/**
 * The seam every `alepha lore <cmd>` sits on: where Lore is, and how to
 * authenticate to it.
 *
 * It is a separate unit from any command because the OAuth 2.0 device flow
 * replaces exactly this and nothing else later. Everything below is what that
 * replacement has to keep true.
 */
describe("LoreClientService", () => {
  const create = (
    env: Record<string, string> = {},
    options?: { project?: string },
  ) => {
    const alepha = Alepha.create({ env });
    if (options) {
      alepha.set(loreOptions, options);
    }
    return alepha.inject(LoreClientService);
  };

  describe("where Lore is", () => {
    /**
     * The same default `SIGIL_SINK` carries, and for the same reason: a
     * commons that is there if you want it and one variable away if you do
     * not.
     */
    it("defaults to the public instance", () => {
      expect(create({ LORE_API_KEY: "k" }).scope().hostname).toBe(
        "https://lore.alepha.dev",
      );
    });

    it("takes LORE_URL for a self-hosted sink", () => {
      const scope = create({
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.example.com",
      }).scope();

      expect(scope.hostname).toBe("https://lore.example.com");
    });
  });

  describe("the credential", () => {
    /**
     * A thunk rather than a string, and awaited per request rather than
     * resolved once: a device-flow token refreshes, and a long-running process
     * that pinned the first value would work for an hour and then fail for
     * good.
     */
    it("is a thunk yielding a bearer header", async () => {
      const scope = create({ LORE_API_KEY: "lore_secret" }).scope();

      expect(typeof scope.authorization).toBe("function");
      expect(await (scope.authorization as () => Promise<string>)()).toBe(
        "Bearer lore_secret",
      );
    });

    /**
     * The error a CI job hits first, so it names the variable rather than
     * describing the problem.
     */
    it("names LORE_API_KEY when it is unset", () => {
      const scope = create().scope();

      expect(() => (scope.authorization as () => string)()).toThrowError(
        /LORE_API_KEY/,
      );
    });

    /**
     * Resolving the key lazily is what lets a command be constructed, and its
     * `--help` printed, on a machine that holds no credential at all.
     */
    it("does not read the key until a request needs it", () => {
      expect(() => create().scope()).not.toThrow();
    });
  });

  describe("which project", () => {
    it("takes the configured project", () => {
      expect(create({}, { project: "alepha" }).resolveProject()).toBe("alepha");
    });

    it("lets --project win for one invocation", () => {
      expect(create({}, { project: "alepha" }).resolveProject("other")).toBe(
        "other",
      );
    });

    it("names both ways of supplying it when neither is set", () => {
      expect(() => create().resolveProject()).toThrowError(/--project/);
      expect(() => create().resolveProject()).toThrowError(/alepha.config/);
    });
  });
});
