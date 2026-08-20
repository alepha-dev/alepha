import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ReactBrowserProvider,
  reactBrowserOptions,
} from "../providers/ReactBrowserProvider.ts";

/**
 * Back/forward used to land at the top of the page.
 *
 * `onTransitionEnd` scrolled to `0` on every transition without ever asking
 * whether the navigation was a push or a pop, so the browser restored the
 * offset on `popstate` and the router immediately overwrote it (quest #192).
 *
 * The decision now lives in `resolveScrollAction`, which is what these tests
 * drive — the hook itself no-ops under `isTest()`.
 */
class TestReactBrowserProvider extends ReactBrowserProvider {
  public setNavigationKind(kind: "push" | "replace" | "pop") {
    this.navigationKind = kind;
  }

  public setEntry(key: number, top?: number) {
    this.historyKey = key;
    if (top !== undefined) {
      this.scrollPositions.set(key, top);
    }
  }

  public testPushState = this.pushState.bind(this);
  public testNextFrame = this.nextFrame.bind(this);

  /** Subclass seams instead of spies, per the repo's testing rules. */
  public hidden = false;
  public scheduled: Array<"timeout" | "frame"> = [];

  protected override get documentHidden(): boolean {
    return this.hidden;
  }

  protected override scheduleTimeout(fn: () => void): void {
    this.scheduled.push("timeout");
    fn();
  }

  protected override scheduleFrame(fn: () => void): void {
    this.scheduled.push("frame");
    fn();
  }
}

describe("scroll restoration", () => {
  let alepha: Alepha;
  let provider: TestReactBrowserProvider;

  beforeEach(() => {
    alepha = Alepha.create();
    provider = alepha.inject(TestReactBrowserProvider);
  });

  describe("auto (the default)", () => {
    it("should default to auto, so an untouched app restores on back", () => {
      // Behavioural on purpose: a fresh container with no options set must
      // already restore rather than jump to the top. Asserting the literal
      // default would still pass if the hook ignored it.
      provider.setEntry(1, 320);
      provider.setNavigationKind("pop");

      expect(provider.resolveScrollAction()).toEqual({
        type: "restore",
        top: 320,
      });
    });

    it("should restore the saved offset when going back", () => {
      provider.setEntry(3, 4200);
      provider.setNavigationKind("pop");

      expect(provider.resolveScrollAction()).toEqual({
        type: "restore",
        top: 4200,
      });
    });

    it("should go to the top for a new navigation", () => {
      provider.setEntry(3, 4200);
      provider.setNavigationKind("push");

      expect(provider.resolveScrollAction()).toEqual({ type: "top" });
    });

    it("should restore 0 for an entry it never saved", () => {
      provider.setEntry(99);
      provider.setNavigationKind("pop");

      expect(provider.resolveScrollAction()).toEqual({
        type: "restore",
        top: 0,
      });
    });

    it("should keep each entry's own offset", () => {
      provider.setEntry(1, 150);
      provider.setEntry(2, 900);

      provider.setNavigationKind("pop");
      provider.setEntry(1);
      expect(provider.resolveScrollAction()).toEqual({
        type: "restore",
        top: 150,
      });

      provider.setEntry(2);
      expect(provider.resolveScrollAction()).toEqual({
        type: "restore",
        top: 900,
      });
    });

    it("should scroll to the anchor when a new navigation carries a hash", () => {
      provider.setNavigationKind("push");

      expect(provider.resolveScrollAction("the-saas-preset")).toEqual({
        type: "hash",
        hash: "the-saas-preset",
      });
    });

    it("should prefer the saved offset over the hash when going back", () => {
      provider.setEntry(2, 640);
      provider.setNavigationKind("pop");

      expect(provider.resolveScrollAction("section")).toEqual({
        type: "restore",
        top: 640,
      });
    });

    it("should treat a replace like a new entry", () => {
      provider.setEntry(1, 500);
      provider.setNavigationKind("replace");

      expect(provider.resolveScrollAction()).toEqual({ type: "top" });
    });
  });

  describe("other modes", () => {
    it("should always go to the top under `top`, back included", () => {
      alepha.store.set(reactBrowserOptions.key, {
        scrollRestoration: "top",
        interceptAnchorClicks: true,
      });
      provider.setEntry(3, 4200);
      provider.setNavigationKind("pop");

      expect(provider.resolveScrollAction()).toEqual({ type: "top" });
    });

    it("should do nothing under `manual`", () => {
      alepha.store.set(reactBrowserOptions.key, {
        scrollRestoration: "manual",
        interceptAnchorClicks: true,
      });
      provider.setNavigationKind("push");

      expect(provider.resolveScrollAction("anchor")).toEqual({ type: "none" });
    });
  });

  describe("scheduling the restore", () => {
    /**
     * `requestAnimationFrame` never fires while the document is hidden, so a
     * restore scheduled only that way silently never happened — the page was
     * left at the top when the reader came back to the tab. Found by testing
     * in a hidden preview pane, where rAF stayed pending forever.
     */
    it("should not depend on requestAnimationFrame when the document is hidden", () => {
      provider.hidden = true;
      let ran = false;

      provider.testNextFrame(() => {
        ran = true;
      });

      expect(provider.scheduled).toEqual(["timeout"]);
      expect(ran).toBe(true);
    });

    it("should use requestAnimationFrame when the document is visible", () => {
      provider.hidden = false;

      provider.testNextFrame(() => {});

      expect(provider.scheduled).toEqual(["frame"]);
    });
  });

  describe("history keys", () => {
    it("should stamp a new id on push so entries stay distinguishable", () => {
      provider.testPushState("/a");
      const first = (history.state as { alephaKey?: number })?.alephaKey;

      provider.testPushState("/b");
      const second = (history.state as { alephaKey?: number })?.alephaKey;

      expect(typeof first).toBe("number");
      expect(second).not.toBe(first);
    });

    it("should keep the id on replace: it is the same entry", () => {
      provider.testPushState("/a");
      const before = (history.state as { alephaKey?: number })?.alephaKey;

      provider.testPushState("/a?x=1", true);
      const after = (history.state as { alephaKey?: number })?.alephaKey;

      expect(after).toBe(before);
    });
  });

  describe("canGoBack", () => {
    it("should be false on the entry the app was loaded into", () => {
      // A deep link, a refresh, or an arrival from another site: going back
      // here leaves the app, which is exactly what a caller needs to know so
      // it can fall back to an explicit destination instead.
      expect(provider.canGoBack).toBe(false);
    });

    it("should be true once the app has pushed an entry of its own", () => {
      provider.testPushState("/a");

      expect(provider.canGoBack).toBe(true);
    });

    it("should stay false after a replace, which creates nowhere to return to", () => {
      provider.testPushState("/a", true);

      expect(provider.canGoBack).toBe(false);
    });

    it("should be false again after popping back to the first entry", () => {
      provider.testPushState("/a");
      // What the popstate listener does when the user goes back: adopt the
      // id stamped on the entry being arrived at.
      provider.setEntry(0);

      expect(provider.canGoBack).toBe(false);
    });
  });
});
