import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { LoreClientService } from "../services/LoreClientService.ts";

/**
 * The seam every `lore <cmd>` sits on: where Lore is, and how to
 * authenticate to it.
 *
 * It is a separate unit from any command because the OAuth 2.0 device flow
 * replaces exactly this and nothing else later. Everything below is what that
 * replacement has to keep true.
 */
describe("LoreClientService", () => {
  const create = (env: Record<string, string> = {}) => {
    // ⚠️ All three blanked unless a case sets them. They are real variables
    // that a developer who has ever run this command for real will have
    // exported, and a spec that reads the ambient environment passes or fails
    // by machine. Its sibling `QualityCommand.spec.ts` learned this from CI:
    // GitHub Actions sets `GITHUB_SHA`, so the git-fallback cases there
    // silently asserted nothing.
    const alepha = Alepha.create({
      // `HOME` too, and pointed at a directory that does not exist: the
      // credential lookup now falls back to a device-flow token cached under
      // it, and a spec reading the real home directory would pass or fail by
      // whether the person running it had ever typed `lore login`.
      env: {
        LORE_API_KEY: "",
        LORE_URL: "",
        LORE_PROJECT: "",
        LORE_APP: "",
        LORE_ENV: "",
        HOME: "/nonexistent",
        ...env,
      },
    });
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
     *
     * ⚠️ It now names BOTH fixes, and rejects rather than throwing: since the
     * device flow landed, the lookup reads a cached token before giving up, so
     * it is async. What it must never do is start a login - there is nobody on
     * a runner to approve a code, and a poll loop there hangs the job. See
     * `LoreCredentials.spec.ts` for the precedence in full.
     */
    it("names both fixes when there is no credential at all", async () => {
      const scope = create().scope();

      await expect(
        (scope.authorization as () => Promise<string>)(),
      ).rejects.toThrow(/LORE_API_KEY/);
    });

    /**
     * Resolving the key lazily is what lets a command be constructed, and its
     * `--help` printed, on a machine that holds no credential at all.
     */
    it("does not read the key until a request needs it", () => {
      expect(() => create().scope()).not.toThrow();
    });
  });

  /**
   * Two rungs and a throw, since the config that used to be the second rung
   * is gone: a workflow sets `LORE_PROJECT` once, and a step that means to
   * push somewhere else passes `--project`.
   */
  describe("which project", () => {
    it("takes LORE_PROJECT", () => {
      expect(create({ LORE_PROJECT: "alepha" }).resolveProject()).toBe(
        "alepha",
      );
    });

    it("lets --project win for one invocation", () => {
      expect(create({ LORE_PROJECT: "alepha" }).resolveProject("other")).toBe(
        "other",
      );
    });

    /**
     * ⚠️ `||`, not `??`. A schema default only fills an ABSENT variable, so
     * `LORE_PROJECT=` in a `.env` file or a CI environment reaches this method
     * as an empty string that is present. With `??` it would resolve to an
     * empty slug and the request would go to a URL with a hole in it, instead
     * of to the error that names the fix.
     */
    it("reads an empty LORE_PROJECT as unset, not as a slug", () => {
      expect(() => create({ LORE_PROJECT: "" }).resolveProject()).toThrow(
        /No Lore project named/,
      );
    });

    it("names both ways of supplying it when neither is set", () => {
      expect(() => create().resolveProject()).toThrow(/--project/);
      expect(() => create().resolveProject()).toThrow(/LORE_PROJECT/);
    });
  });

  /**
   * The two axes the `lore apps` commands added (#1811).
   *
   * ⚠️ Both answer `undefined` rather than throwing, unlike the project. Each
   * has a third rung this class cannot reach - the directory's `package.json`
   * for the app, and a REMOTE read of the project's own default for the env -
   * so the throw belongs to `LoreProjectResolver`, which walks the whole chain.
   */
  describe("which app and which environment", () => {
    it("takes LORE_APP and LORE_ENV", () => {
      const service = create({ LORE_APP: "docs", LORE_ENV: "staging" });

      expect(service.appFromEnv()).toBe("docs");
      expect(service.envFromEnv()).toBe("staging");
    });

    it("lets the flags win for one invocation", () => {
      const service = create({ LORE_APP: "docs", LORE_ENV: "staging" });

      expect(service.appFromEnv("shop")).toBe("shop");
      expect(service.envFromEnv("b14-production")).toBe("b14-production");
    });

    /**
     * ⚠️ `||`, not `??`, the rule `resolveProject` already carries. A schema
     * default only fills an ABSENT variable, and `LORE_APP=` in a CI
     * environment is present and empty. With `??` an empty string would win
     * over the package name and the artifact would be filed under nothing.
     */
    it("reads an empty variable as unset rather than as a name", () => {
      const service = create({ LORE_APP: "", LORE_ENV: "" });

      expect(service.appFromEnv()).toBeUndefined();
      expect(service.envFromEnv()).toBeUndefined();
    });

    it("reads an empty FLAG as unset too, so a blank CI input falls through", () => {
      const service = create({ LORE_APP: "docs", LORE_ENV: "staging" });

      // `--app=` on the command line, or a workflow input that expanded to
      // nothing. Falling through to the variable is the useful reading; the
      // alternative is an app named "".
      expect(service.appFromEnv("")).toBe("docs");
      expect(service.envFromEnv("")).toBe("staging");
    });
  });
});
