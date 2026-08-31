import { Alepha } from "alepha";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `alepha.meta` under vitest, where no build ever ran.
 *
 * This is the fallback path, and it is the one most likely to be wrong in a
 * way nothing notices: the build token is replaced by a transform, so any
 * runtime that never went through `alepha build` or `alepha dev` reads the
 * constant below instead. An unreplaced bare identifier throws `ReferenceError`
 * rather than evaluating to `undefined`, which is why the read is guarded by
 * `typeof` and why this test exists at all.
 */
describe("Alepha.meta", () => {
  it("should fall back to a known record when no build produced this code", () => {
    const alepha = Alepha.create();

    expect(alepha.meta).toEqual({
      name: "unknown",
      version: "latest",
      framework: "unknown",
      build: {
        runtime: "node",
        dev: true,
      },
    });
  });

  it("should omit build.date rather than invent one, because nothing built this", () => {
    const alepha = Alepha.create();

    // Absence is the signal: no `date` means no build produced this code.
    // A placeholder string here would be indistinguishable from a real build.
    expect(alepha.meta.build.date).toBeUndefined();
  });

  it('should omit commit rather than report "unknown"', () => {
    const alepha = Alepha.create();

    expect(alepha.meta.commit).toBeUndefined();
  });

  describe("a record installed on globalThis", () => {
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).__ALEPHA_META__;
    });

    /**
     * How the build hands the record to an in-process render.
     *
     * `BuildPrerenderTask` invokes route and page handlers inside the CLI's own
     * process, where the build token was never substituted, so a prerendered
     * page would otherwise bake the no-build fallback into its HTML. Assigning
     * to `globalThis` creates a real global BINDING, which is what the plain
     * `typeof` guard already looks for - the same mechanism the dev server uses
     * for the browser.
     */
    it("should be read in preference to the no-build fallback", () => {
      (globalThis as Record<string, unknown>).__ALEPHA_META__ = JSON.stringify({
        name: "docs",
        version: "0.27.1",
        commit: "1972cdf5",
        build: {
          date: "2026-08-31T17:36:45.475Z",
          runtime: "static",
          dev: false,
        },
        framework: "0.27.1",
      });

      expect(Alepha.create().meta.version).toBe("0.27.1");
    });

    /**
     * The fallback must not be sticky.
     *
     * The build resolves and installs the record after the app container
     * already exists, so anything that read `meta` during introspection would
     * otherwise pin the fallback in the memo and the prerender would still
     * write "latest".
     */
    it("should not be shadowed by an earlier read that fell back", () => {
      const alepha = Alepha.create();
      expect(alepha.meta.version).toBe("latest");

      (globalThis as Record<string, unknown>).__ALEPHA_META__ = JSON.stringify({
        name: "docs",
        version: "0.27.1",
        build: { runtime: "static", dev: false },
        framework: "0.27.1",
      });

      expect(alepha.meta.version).toBe("0.27.1");
    });
  });
});
