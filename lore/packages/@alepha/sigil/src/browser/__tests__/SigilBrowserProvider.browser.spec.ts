import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import { SigilBrowserProvider } from "../SigilBrowserProvider.ts";

/**
 * Reaches the first-ingest trigger, which is otherwise driven by a
 * `PerformanceObserver` and a two-second timer — neither of which a test
 * should have to wait on.
 */
class TestSigilBrowserProvider extends SigilBrowserProvider {
  public testSetFirstIngestDelay(ms: number) {
    this.firstIngestDelayMs = ms;
  }
  public testLcpArrived() {
    this.onLcpArrived();
  }
  public testSetDwell(ms: number) {
    this.dwellMs = ms;
  }
}

describe("SigilBrowserProvider", () => {
  it("enqueues a pageview on react:transition:end (prod + browser)", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    alepha.store.set(sigilClientAtom, {
      enabled: { views: true, errors: true, vitals: true },
      feedbackButtonExcludedPaths: [],
      configAt: Date.now(),
    });
    // Hydration first — a transition before it is the hydration render itself,
    // which `react:browser:render` owns.
    await (alepha.events as any).emit("react:browser:render", {});
    await (alepha.events as any).emit("react:transition:end", {
      state: { url: { pathname: "/dash" } },
    });
    expect(provider.debugPendingViews()).toContain("/dash");
  });

  /**
   * jsdom's `document.referrer` is a getter with no setter, and the value is
   * fixed at document creation. Redefining the property is the only way to
   * drive it, and it is done per-test rather than in a shared setup so a test
   * that does not care keeps jsdom's own empty default.
   */
  const withReferrer = (value: string) => {
    const original = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "referrer",
    );
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => value,
    });
    return () => {
      delete (document as any).referrer;
      if (original)
        Object.defineProperty(Document.prototype, "referrer", original);
    };
  };

  const prodAlepha = () =>
    Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });

  it("attaches the referrer host to the landing pageview", async () => {
    const restore = withReferrer("https://news.ycombinator.com/item?id=42");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(SigilBrowserProvider);
      await alepha.start();

      await (alepha.events as any).emit("react:browser:render", {});

      expect(provider.debugPendingViews()).toEqual(["/"]);
      // Host only. The path and query belong to a third-party page.
      expect(provider.debugPendingViewReferrers()).toEqual([
        "news.ycombinator.com",
      ]);
    } finally {
      restore();
    }
  });

  it("leaves the referrer off every view after the landing one", async () => {
    const restore = withReferrer("https://news.ycombinator.com/item?id=42");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(SigilBrowserProvider);
      await alepha.start();
      alepha.store.set(sigilClientAtom, {
        enabled: { views: true, errors: true, vitals: true },
        feedbackButtonExcludedPaths: [],
        configAt: Date.now(),
      });

      await (alepha.events as any).emit("react:browser:render", {});
      await (alepha.events as any).emit("react:transition:end", {
        state: { url: { pathname: "/docs" } },
      });
      await (alepha.events as any).emit("react:transition:end", {
        state: { url: { pathname: "/docs/guides" } },
      });

      // `document.referrer` does not change across a client-side navigation.
      // Attaching it to each view would report one arrival from Hacker News
      // as three.
      expect(provider.debugPendingViews()).toEqual([
        "/",
        "/docs",
        "/docs/guides",
      ]);
      expect(provider.debugPendingViewReferrers()).toEqual([
        "news.ycombinator.com",
        undefined,
        undefined,
      ]);
    } finally {
      restore();
    }
  });

  it("drops a same-origin referrer instead of reporting itself", async () => {
    const restore = withReferrer(`${location.origin}/docs/guides`);
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(SigilBrowserProvider);
      await alepha.start();

      await (alepha.events as any).emit("react:browser:render", {});

      expect(provider.debugPendingViewReferrers()).toEqual([undefined]);
    } finally {
      restore();
    }
  });

  it("marks the landing view as an entry and carries its campaign tag", async () => {
    const restore = withReferrer("https://news.ycombinator.com/x");
    const search = Object.getOwnPropertyDescriptor(window, "location");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(SigilBrowserProvider);
      await alepha.start();
      alepha.store.set(sigilClientAtom, {
        enabled: { views: true, errors: true, vitals: true },
        feedbackButtonExcludedPaths: [],
        configAt: Date.now(),
      });

      history.replaceState({}, "", "/?utm_source=HN&token=secret");
      await (alepha.events as any).emit("react:browser:render", {});
      await (alepha.events as any).emit("react:transition:end", {
        state: { url: { pathname: "/docs" } },
      });

      const records = provider.debugPendingViewRecords();
      expect(records[0]).toMatchObject({
        path: "/",
        entry: true,
        referrer: "news.ycombinator.com",
        campaign: "hn",
      });
      // A client-side navigation is not an arrival, so it carries none of the
      // three arrival facts — otherwise one visit would report as several.
      expect(records[1].entry).toBeUndefined();
      expect(records[1].campaign).toBeUndefined();
      expect(records[1].referrer).toBeUndefined();
    } finally {
      restore();
      if (search) Object.defineProperty(window, "location", search);
    }
  });

  it("records engagement once per path, on the first real signal", async () => {
    const alepha = prodAlepha();
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    alepha.store.set(sigilClientAtom, {
      enabled: { views: true, errors: true, vitals: true },
      feedbackButtonExcludedPaths: [],
      configAt: Date.now(),
    });

    history.replaceState({}, "", "/");
    await (alepha.events as any).emit("react:browser:render", {});
    expect(provider.debugPendingEngagements()).toEqual([]);

    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("click"));

    // Three signals, one row: `engaged` is a fraction of `count`, so a page
    // scrolled twice must not report as engaged twice.
    expect(provider.debugPendingEngagements()).toEqual(["/"]);
  });

  it("re-arms engagement for each new path", async () => {
    const alepha = prodAlepha();
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    alepha.store.set(sigilClientAtom, {
      enabled: { views: true, errors: true, vitals: true },
      feedbackButtonExcludedPaths: [],
      configAt: Date.now(),
    });

    history.replaceState({}, "", "/");
    await (alepha.events as any).emit("react:browser:render", {});
    window.dispatchEvent(new Event("scroll"));

    await (alepha.events as any).emit("react:transition:end", {
      state: { url: { pathname: "/docs" } },
    });
    window.dispatchEvent(new Event("scroll"));

    // Without the reset, scrolling the landing page would have marked every
    // later page engaged too, whether or not the visitor read any of them.
    expect(provider.debugPendingEngagements()).toEqual(["/", "/docs"]);
  });

  it("counts dwelling as engagement for a page nobody scrolls", async () => {
    const alepha = prodAlepha();
    const provider = alepha.inject(TestSigilBrowserProvider);
    await alepha.start();
    alepha.store.set(sigilClientAtom, {
      enabled: { views: true, errors: true, vitals: true },
      feedbackButtonExcludedPaths: [],
      configAt: Date.now(),
    });

    provider.testSetDwell(5);
    history.replaceState({}, "", "/");
    await (alepha.events as any).emit("react:browser:render", {});
    expect(provider.debugPendingEngagements()).toEqual([]);

    await new Promise((r) => setTimeout(r, 25));

    // The reader who opens a short page, reads it without moving, and leaves.
    expect(provider.debugPendingEngagements()).toEqual(["/"]);
  });

  it("records no engagement when the views tracker is off", async () => {
    const alepha = prodAlepha();
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    alepha.store.set(sigilClientAtom, {
      enabled: { views: false, errors: true, vitals: true },
      feedbackButtonExcludedPaths: [],
      configAt: Date.now(),
    });

    await (alepha.events as any).emit("react:browser:render", {});
    window.dispatchEvent(new Event("scroll"));

    // An `engaged` total outliving the `count` it divides into would be worse
    // than collecting nothing.
    expect(provider.debugPendingViews()).toEqual([]);
    expect(provider.debugPendingEngagements()).toEqual([]);
  });

  it("counts the hydration render once, not twice", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    // A page rendered for this visit. A stale stamp would trigger the config
    // handshake, which flushes the queue — correct, and not what this asserts.
    alepha.store.set(sigilClientAtom, {
      enabled: { views: true, errors: true, vitals: true },
      feedbackButtonExcludedPaths: [],
      configAt: Date.now(),
    });

    // What `ReactBrowserProvider.ready` actually does: await `render()`, which
    // emits the transition, then emit the browser render ~2ms later. Counting
    // both inflated every visit's landing page by exactly one view.
    await (alepha.events as any).emit("react:transition:end", {
      state: { url: { pathname: "/" } },
    });
    await (alepha.events as any).emit("react:browser:render", {});

    expect(provider.debugPendingViews()).toEqual(["/"]);

    // And the transition listener takes over from there.
    await (alepha.events as any).emit("react:transition:end", {
      state: { url: { pathname: "/docs/intro" } },
    });
    expect(provider.debugPendingViews()).toEqual(["/", "/docs/intro"]);
  });

  it("does not enqueue a pageview when the beacon feature is off", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    // The sink turned views off: nothing is collected, rather than collected
    // and discarded later.
    alepha.store.set(sigilClientAtom, {
      enabled: { views: false, errors: true, vitals: true },
      feedbackButtonExcludedPaths: [],
      configAt: Date.now(),
    });
    await (alepha.events as any).emit("react:browser:render", {});
    await (alepha.events as any).emit("react:transition:end", {
      state: { url: { pathname: "/dash" } },
    });
    expect(provider.debugPendingViews()).toEqual([]);
  });

  it("is inert in dev (no queue built)", async () => {
    const alepha = Alepha.create({ env: { NODE_ENV: "development" } });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    await (alepha.events as any).emit("react:transition:end", {
      state: { url: { pathname: "/x" } },
    });
    expect(provider.debugPendingViews()).toEqual([]);
  });

  /**
   * The page was prerendered, so its stamped config is stale and the browser
   * has to ask. It used to ask the instant the render hook fired, which put a
   * request on the wire while the main thread was still hydrating and spent a
   * whole round trip carrying a single pageview. The ask now waits for LCP or
   * the fallback timer, so the view rides along with whatever else the page
   * has produced by then.
   */
  it("does not ask for config the instant the render hook fires", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    // `configAt: 0` is the atom's default — stale by construction, which is
    // exactly what a prerendered page carries.
    await (alepha.events as any).emit("react:browser:render", {});

    expect(provider.debugPendingViews()).toEqual(["/"]);
  });

  it("sends the first ingest as soon as LCP arrives", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });
    const provider = alepha.inject(TestSigilBrowserProvider);
    await alepha.start();
    await (alepha.events as any).emit("react:browser:render", {});
    expect(provider.debugPendingViews()).toEqual(["/"]);

    provider.testLcpArrived();

    expect(provider.debugPendingViews()).toEqual([]);
  });

  /**
   * LCP never arrives on a browser without the entry type, and never arrives
   * on a page whose largest element is already painted at first paint. The
   * timer is what stops such a page from never hearing its config again.
   */
  it("sends the first ingest on the fallback timer when LCP never arrives", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });
    const provider = alepha.inject(TestSigilBrowserProvider);
    await alepha.start();
    provider.testSetFirstIngestDelay(5);
    await (alepha.events as any).emit("react:browser:render", {});
    expect(provider.debugPendingViews()).toEqual(["/"]);

    await new Promise((r) => setTimeout(r, 40));

    expect(provider.debugPendingViews()).toEqual([]);
  });

  /**
   * LCP can be reported before the render hook has run, and the pageview is
   * only queued by that hook. Firing the ingest on the earlier signal would
   * send an envelope without the view and leave the view for a second request
   * — the exact cost this change exists to remove.
   */
  it("still carries the pageview when LCP lands before the render hook", async () => {
    const alepha = Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });
    const provider = alepha.inject(TestSigilBrowserProvider);
    await alepha.start();

    provider.testLcpArrived();
    expect(provider.debugPendingViews()).toEqual([]);

    await (alepha.events as any).emit("react:browser:render", {});

    expect(provider.debugPendingViews()).toEqual([]);
  });
});
