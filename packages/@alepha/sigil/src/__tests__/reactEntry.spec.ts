import { describe, expect, it } from "vitest";

/**
 * The React surface has to be reachable from a server too.
 *
 * This file runs in the **node** vitest project, so it resolves
 * `@alepha/sigil/react` through the package's own `exports` map under the
 * default (non-`browser`) conditions — exactly what a `tsc` pass, an SSR render
 * and a plain `node` import all do.
 *
 * The regression it guards: `SigilRoot` and `SigilFeedbackButton` shipped for a
 * while exported only from `index.browser.ts`, i.e. only behind the `browser`
 * condition. `types` / `import` / `default` all resolved `index.ts`, which did
 * not export them, so `import { SigilRoot } from "@alepha/sigil"` was
 * `TS2305: has no exported member` in every host that was not a client bundle,
 * and an SSR host broke on the server pass of the component it was told to
 * render. A `browser`-only entry is invisible to this spec by construction.
 */
describe("@alepha/sigil/react", () => {
  it("resolves outside the browser condition", async () => {
    const entry = await import("@alepha/sigil/react");

    expect(typeof entry.SigilRoot).toBe("function");
    expect(typeof entry.SigilFeedbackButton).toBe("function");
    expect(typeof entry.useFeedbackUrl).toBe("function");
  });

  it("keeps the React surface out of the module entry", async () => {
    // The components keep exactly one import path, `@alepha/sigil/react`, so a
    // host never has to guess which entry a symbol came from. `.` *mounts*
    // `<SigilRoot />` through `RootComponentsProvider` — mounting and
    // re-exporting are separate questions, and only the first is the module's
    // job.
    const root = await import("../index.ts");

    expect(Object.keys(root)).not.toContain("SigilRoot");
    expect(Object.keys(root)).not.toContain("SigilFeedbackButton");
  });
});
