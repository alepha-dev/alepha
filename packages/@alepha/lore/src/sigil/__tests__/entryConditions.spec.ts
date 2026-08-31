import { describe, expect, it } from "vitest";

/**
 * The package has one public path, and that path is condition-split.
 *
 * `@alepha/lore` resolves to `index.browser.ts` in a client bundle and to
 * `index.ts` everywhere else - a `tsc` pass, an SSR render, a plain `node`
 * import. Two files behind one specifier is the whole risk this file exists to
 * bound: a symbol exported by only one of them type-checks against `index.d.ts`
 * and then is not there at runtime, in whichever half nobody tested.
 *
 * The regression it guards is real and already happened once. `SigilRoot` and
 * `SigilFeedbackButton` shipped for a while exported only from
 * `index.browser.ts`, so `import { SigilRoot } from "@alepha/lore/sigil"` was
 * `TS2305: has no exported member` in every host that was not a client bundle,
 * and an SSR host broke on the server pass of the component it was told to
 * render. That bought the package a `./react` subpath, which nothing ever
 * imported; exporting the surface from both entries is the fix that subpath was
 * standing in for.
 *
 * The invariant is a subset, not equality: the browser entry drops the server
 * services, which import `alepha/server` and do not resolve in a client bundle.
 * Anything reachable in the browser must be reachable on the server, because
 * SSR renders the browser's own components; the reverse is allowed.
 */
describe("@alepha/lore entry conditions", () => {
  it("exports the React surface outside the browser condition", async () => {
    const entry = await import("@alepha/lore/sigil");

    expect(typeof entry.SigilRoot).toBe("function");
    expect(typeof entry.SigilFeedbackButton).toBe("function");
    expect(typeof entry.useFeedbackUrl).toBe("function");
  });

  it("keeps the browser entry a subset of the default entry", async () => {
    const [server, browser] = await Promise.all([
      import("../index.ts"),
      import("../index.browser.ts"),
    ]);

    const missing = Object.keys(browser).filter((name) => !(name in server));

    expect(missing).toEqual([]);
  });

  it("keeps the server services out of the browser entry", async () => {
    const browser = await import("../index.browser.ts");

    expect(Object.keys(browser)).not.toContain("SigilSinkProvider");
  });
});
