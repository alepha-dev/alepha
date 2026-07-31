import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import type { AppEntry } from "../providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "../providers/ViteBuildProvider.ts";

/**
 * Exposes the entry check without booting a Vite build.
 */
class TestViteBuildProvider extends ViteBuildProvider {
  public setEntry(entry: AppEntry) {
    this.appEntry = entry;
  }
  public testHasDistinctBrowserEntry() {
    return this.hasDistinctBrowserEntry();
  }
}

const provider = () => Alepha.create().inject(TestViteBuildProvider);

describe("ViteBuildProvider — deciding an app has a client", () => {
  it("should see a client when the browser entry is its own file", () => {
    const p = provider();
    p.setEntry({
      root: "/app",
      server: "src/main.ts",
      browser: "src/main.browser.ts",
    });

    expect(p.testHasDistinctBrowserEntry()).toBe(true);
  });

  it("should NOT see a client when browser resolves to the server entry", () => {
    /*
      The regression this exists for.

      A server-only app does not get an empty `browser` — it resolves to the
      SERVER entry. So a bare `if (entry.browser)` is true for every app in the
      repo, and every server-only one started bundling its controllers for the
      browser: `"$action" is not exported by server/core/index.browser.ts`, out
      of a build that had been green for months.

      Shipped once already, in a fix that was correct for the app it was found
      in — which has a real `main.browser.ts` — and wrong for everything else.
    */
    const p = provider();
    p.setEntry({ root: "/app", server: "src/main.ts", browser: "src/main.ts" });

    expect(p.testHasDistinctBrowserEntry()).toBe(false);
  });

  it("should NOT see a client when there is no browser entry at all", () => {
    const p = provider();
    p.setEntry({ root: "/app", server: "src/main.ts" });

    expect(p.testHasDistinctBrowserEntry()).toBe(false);
  });
});
