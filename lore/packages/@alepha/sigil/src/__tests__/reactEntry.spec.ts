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
    expect(typeof entry.usePetitionUrl).toBe("function");
  });

  it("keeps the React surface out of the module entry", async () => {
    // Not a style rule: `.` registers the module and reaches `alepha/server`,
    // so a headless API app imports it with no React anywhere. Rendering is
    // opt-in, and so is paying for React.
    const root = await import("../index.ts");

    expect(Object.keys(root)).not.toContain("SigilRoot");
    expect(Object.keys(root)).not.toContain("SigilFeedbackButton");
  });
});
