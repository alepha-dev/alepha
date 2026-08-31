import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SigilVitals } from "../SigilVitals.ts";

/**
 * Reaches the LCP entry handler without a `PerformanceObserver`, which jsdom
 * does not dispatch largest-contentful-paint entries through.
 */
class TestSigilVitals extends SigilVitals {
  public testNoteLcp(value: number) {
    this.noteLcp(value);
  }
}

describe("SigilVitals", () => {
  it("reports finalized metrics, ms rounded, CLS scaled to int", () => {
    const got: any[] = [];
    const v = new SigilVitals((m) => got.push(m));
    v.report("lcp", 2345.6);
    v.report("cls", 0.123);
    expect(got).toEqual([
      { metric: "lcp", value: 2346, path: "/" },
      { metric: "cls", value: 123, path: "/" },
    ]);
  });

  /**
   * `ttfb` shipped twice on every page view in production — the navigation
   * entry reaches a `buffered: true` observer once from the buffer and again on
   * dispatch. A duplicate does not move the p75, it inflates the population the
   * p75 is computed over, so one visitor counts as two.
   */
  it("emits each metric once, dropping the duplicate report", () => {
    const got: any[] = [];
    const v = new SigilVitals((m) => got.push(m));

    v.report("ttfb", 76);
    v.report("ttfb", 76);

    expect(got).toEqual([{ metric: "ttfb", value: 76, path: "/" }]);
  });

  /**
   * `finalize` runs on every `visibilitychange` to hidden, so a visitor who
   * tabs away and comes back reported the accumulating metrics again — with a
   * *different* value the second time, which is the case most likely to look
   * like real data.
   */
  it("keeps the first value when a later report carries a different one", () => {
    const got: any[] = [];
    const v = new SigilVitals((m) => got.push(m));

    v.report("cls", 0.05);
    v.report("cls", 0.42);

    expect(got).toEqual([{ metric: "cls", value: 50, path: "/" }]);
  });

  it("observe() is a no-op when PerformanceObserver is unavailable", () => {
    const v = new SigilVitals(() => {});
    const orig = (globalThis as any).PerformanceObserver;
    (globalThis as any).PerformanceObserver = undefined;
    expect(() => v.observe()).not.toThrow();
    (globalThis as any).PerformanceObserver = orig;
  });

  /**
   * `SigilBrowserProvider` waits on this to decide the page has settled enough
   * to talk to the server. It has to fire on the *first* entry: LCP is
   * dispatched again for every larger element, and a signal that re-fires would
   * keep re-triggering the thing waiting on it.
   */
  it("notifies onLcp once, on the first entry", () => {
    let notified = 0;
    const v = new TestSigilVitals(
      () => {},
      () => notified++,
    );

    v.testNoteLcp(1200);
    v.testNoteLcp(2400);

    expect(notified).toBe(1);
  });

  /**
   * The callback is a timing signal, not a measurement — the value is still
   * only final at hidden, and the last entry is the one that counts.
   */
  it("still reports the last LCP value, not the one that triggered onLcp", () => {
    const got: any[] = [];
    const v = new TestSigilVitals(
      (m) => got.push(m),
      () => {},
    );

    v.testNoteLcp(1200);
    v.testNoteLcp(2400);
    v.report("lcp", 2400);

    expect(got).toEqual([{ metric: "lcp", value: 2400, path: "/" }]);
  });

  /**
   * An app that collects no vitals still needs the signal, because it is what
   * tells it when to go and ask for its config. Gating the callback behind the
   * metric sink would leave such an app waiting on the fallback timer forever.
   */
  it("notifies onLcp even when nothing consumes the metrics", () => {
    let notified = 0;
    const v = new TestSigilVitals(
      () => {
        throw new Error("sink must not be consulted for the timing signal");
      },
      () => notified++,
    );

    v.testNoteLcp(1500);

    expect(notified).toBe(1);
  });
});

/**
 * A `PerformanceObserver` jsdom does not have, kept simple enough to be
 * obviously right: it hands each entry type's callback back to the test so
 * entries can be delivered on demand.
 */
class FakePerformanceObserver {
  static byType = new Map<string, (entries: any[]) => void>();

  constructor(
    protected readonly cb: (list: { getEntries: () => any[] }) => void,
  ) {}

  observe(options: { type: string }) {
    FakePerformanceObserver.byType.set(options.type, (entries) =>
      this.cb({ getEntries: () => entries }),
    );
  }

  disconnect() {}
}

const deliver = (type: string, entries: any[]) => {
  const cb = FakePerformanceObserver.byType.get(type);
  if (!cb) throw new Error(`nothing observed '${type}'`);
  cb(entries);
};

const hide = () => {
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

/**
 * The finding, end to end: a load on `/a` followed by a client navigation to
 * `/b`.
 *
 * Every accumulating metric is finalised when the tab is hidden, which in a
 * client-routed app is usually several pages after the one it measured. The
 * path was read at that moment, so `/a`'s paint, `/a`'s layout shift and
 * `/a`'s slow click were all filed under `/b` - and the page that was actually
 * slow looked fine.
 */
describe("SigilVitals path attribution", () => {
  let realPO: any;

  beforeEach(() => {
    realPO = (globalThis as any).PerformanceObserver;
    (globalThis as any).PerformanceObserver = FakePerformanceObserver;
    FakePerformanceObserver.byType.clear();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    (globalThis as any).PerformanceObserver = realPO;
  });

  it("files LCP under the page that painted, not the one on screen at hidden", () => {
    const got: any[] = [];
    let path = "/a";
    const v = new SigilVitals(
      (m) => got.push(m),
      undefined,
      () => path,
    );
    v.observe();

    deliver("largest-contentful-paint", [{ startTime: 1800 }]);

    // The visitor reads on.
    path = "/b";
    hide();

    expect(got).toContainEqual({ metric: "lcp", value: 1800, path: "/a" });
    expect(got.filter((m) => m.metric === "lcp")).toHaveLength(1);
  });

  it("splits layout shift between the pages that shifted", () => {
    const got: any[] = [];
    let path = "/a";
    const v = new SigilVitals(
      (m) => got.push(m),
      undefined,
      () => path,
    );
    v.observe();

    deliver("layout-shift", [{ value: 0.02 }, { value: 0.03 }]);
    path = "/b";
    deliver("layout-shift", [{ value: 0.2 }]);
    hide();

    const cls = got.filter((m) => m.metric === "cls");
    expect(cls).toEqual([
      { metric: "cls", value: 50, path: "/a" },
      { metric: "cls", value: 200, path: "/b" },
    ]);
  });

  it("attributes an interaction to the page it was made on", () => {
    const got: any[] = [];
    let path = "/a";
    const v = new SigilVitals(
      (m) => got.push(m),
      undefined,
      () => path,
    );
    v.observe();

    deliver("event", [{ interactionId: 1, duration: 320 }]);
    path = "/b";
    deliver("event", [{ interactionId: 2, duration: 40 }]);
    hide();

    const inp = got.filter((m) => m.metric === "inp");
    expect(inp).toEqual([
      { metric: "inp", value: 320, path: "/a" },
      { metric: "inp", value: 40, path: "/b" },
    ]);
  });

  /**
   * A shift ignored because it followed a click is not a shift. Kept here
   * because the per-path rewrite moved this check, and dropping it would let
   * every scroll-triggered reflow count.
   */
  it("still ignores a shift that followed an interaction", () => {
    const got: any[] = [];
    const v = new SigilVitals(
      (m) => got.push(m),
      undefined,
      () => "/a",
    );
    v.observe();

    deliver("layout-shift", [{ value: 0.4, hadRecentInput: true }]);
    hide();

    expect(got.filter((m) => m.metric === "cls")).toEqual([
      { metric: "cls", value: 0, path: "/a" },
    ]);
  });

  /**
   * The dedup guard now keys on metric AND path. A visitor who tabs away and
   * comes back must not report the same page twice - but a second page is a
   * second sample, not a duplicate.
   */
  it("reports a page once however often the tab is hidden", () => {
    const got: any[] = [];
    let path = "/a";
    const v = new SigilVitals(
      (m) => got.push(m),
      undefined,
      () => path,
    );
    v.observe();

    deliver("layout-shift", [{ value: 0.05 }]);
    hide();
    hide();
    path = "/b";
    hide();

    expect(got.filter((m) => m.metric === "cls")).toEqual([
      { metric: "cls", value: 50, path: "/a" },
      { metric: "cls", value: 0, path: "/b" },
    ]);
  });
});
