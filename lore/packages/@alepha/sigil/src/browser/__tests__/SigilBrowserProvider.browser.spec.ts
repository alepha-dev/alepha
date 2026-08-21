import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
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

/**
 * Captures the envelopes that reach the wire, narrowed to one path.
 *
 * The queue is drained by the send, so anything read from `debugPending*`
 * after a flush is empty whether the row was sent or never recorded at all.
 * What these tests are about is which request a row leaves in, and only the
 * wire can answer that.
 *
 * Narrowed because jsdom keeps one `window` for the whole file while the
 * provider attaches its `scroll`, `click` and `pagehide` listeners for the life
 * of the page. Every container an earlier test built is therefore still
 * listening when a later one dispatches, and its requests land in the same
 * recorder. Giving each test a path of its own is what keeps them apart.
 *
 * `globalThis.fetch` is replaced rather than mocked: the provider builds its
 * sender inside a `start` hook, so there is nothing to substitute through DI,
 * and a plain assignment keeps the test free of `vi.mock`.
 */
const recordIngests = (path: string) => {
  const all: any[] = [];
  const originalFetch = globalThis.fetch;
  const originalUrl = location.pathname + location.search;
  globalThis.fetch = (async (_url: any, init: any) => {
    all.push(JSON.parse(init.body));
    return { json: async () => ({ ok: true }) };
  }) as any;
  history.replaceState({}, "", path);
  return {
    sent: () =>
      all.filter((env: any) =>
        [
          ...(env.views ?? []),
          ...(env.engagements ?? []),
          ...(env.vitals ?? []),
        ].some((row: any) => row.path === path),
      ),
    restore: () => {
      globalThis.fetch = originalFetch;
      history.replaceState({}, "", originalUrl);
    },
  };
};

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
    const { sent, restore } = recordIngests("/engage-once");
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
      expect(provider.debugPendingEngagements()).toEqual([]);

      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("click"));

      // Three signals, one row: `engaged` is a fraction of `count`, so a page
      // scrolled twice must not report as engaged twice.
      expect(sent()).toHaveLength(1);
      expect(sent()[0].engagements.map((e: any) => e.path)).toEqual([
        "/engage-once",
      ]);
    } finally {
      restore();
    }
  });

  it("re-arms engagement for each new path", async () => {
    const { sent, restore } = recordIngests("/rearm");
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
      window.dispatchEvent(new Event("scroll"));

      await (alepha.events as any).emit("react:transition:end", {
        state: { url: { pathname: "/rearm-docs" } },
      });
      window.dispatchEvent(new Event("scroll"));

      // Without the reset, scrolling the landing page would have marked every
      // later page engaged too, whether or not the visitor read any of them.
      // The landing page's row left with the opening envelope; the second one
      // is still queued behind the debounce.
      expect(sent()[0].engagements.map((e: any) => e.path)).toEqual(["/rearm"]);
      expect(provider.debugPendingEngagements()).toEqual(["/rearm-docs"]);
    } finally {
      restore();
    }
  });

  it("counts dwelling as engagement for a page nobody scrolls", async () => {
    const { sent, restore } = recordIngests("/dwell");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(TestSigilBrowserProvider);
      await alepha.start();
      alepha.store.set(sigilClientAtom, {
        enabled: { views: true, errors: true, vitals: true },
        feedbackButtonExcludedPaths: [],
        configAt: Date.now(),
      });

      provider.testSetDwell(5);
      await (alepha.events as any).emit("react:browser:render", {});
      expect(provider.debugPendingEngagements()).toEqual([]);

      await new Promise((r) => setTimeout(r, 25));

      // The reader who opens a short page, reads it without moving, and leaves.
      expect(sent()).toHaveLength(1);
      expect(sent()[0].engagements.map((e: any) => e.path)).toEqual(["/dwell"]);
    } finally {
      restore();
    }
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

/**
 * A page load produces its facts on three different clocks: the view at
 * hydration, TTFB and FCP a beat later, and the engagement verdict only once
 * the visitor has had time to give one. The queue's debounce is armed by the
 * first of them, so it used to send at +5s and leave the verdict to a second
 * request at +15s. These are the tests that say it is one request now.
 */
describe("SigilBrowserProvider - one request per page load", () => {
  const prodAlepha = () =>
    Alepha.create({
      env: {
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
        SERVER_PORT: 0,
      },
    });

  /**
   * A page rendered for this visitor rather than served from something that
   * kept it. Its stamp is now, so it has nothing to ask the sink for and can
   * afford to wait for the verdict.
   */
  const freshConfig = (alepha: Alepha, enabled?: Record<string, boolean>) =>
    alepha.store.set(sigilClientAtom, {
      enabled: enabled ?? { views: true, errors: true, vitals: true },
      feedbackButtonExcludedPaths: [],
      configAt: alepha.inject(DateTimeProvider).nowMillis(),
    });

  it("sends the view and the engagement verdict in the same request", async () => {
    const { sent, restore } = recordIngests("/one-request");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(TestSigilBrowserProvider);
      await alepha.start();
      freshConfig(alepha);
      provider.testSetDwell(5);

      await (alepha.events as any).emit("react:browser:render", {});

      // Held: the debounce is not armed, so nothing can leave before the
      // verdict is in.
      expect(sent()).toHaveLength(0);
      expect(provider.debugQueueHeld()).toBe(true);

      await new Promise((r) => setTimeout(r, 25));

      expect(sent()).toHaveLength(1);
      expect(sent()[0].views.map((v: any) => v.path)).toEqual(["/one-request"]);
      expect(sent()[0].engagements.map((e: any) => e.path)).toEqual([
        "/one-request",
      ]);
    } finally {
      restore();
    }
  });

  /**
   * The hold suspends the debounce, not the queue. A visitor who leaves before
   * the verdict is in has still visited, and losing that would be a far worse
   * trade than the request this saves.
   */
  it("still reports a visitor who leaves during the hold", async () => {
    const { sent, restore } = recordIngests("/leaves-early");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(TestSigilBrowserProvider);
      await alepha.start();
      freshConfig(alepha);
      // Long enough that the verdict cannot be what sends this.
      provider.testSetDwell(60_000);

      await (alepha.events as any).emit("react:browser:render", {});
      expect(sent()).toHaveLength(0);

      window.dispatchEvent(new Event("pagehide"));

      expect(sent()).toHaveLength(1);
      expect(sent()[0].views.map((v: any) => v.path)).toEqual([
        "/leaves-early",
      ]);
      expect(sent()[0].engagements).toBeUndefined();
    } finally {
      restore();
    }
  });

  /**
   * The accepted cost of the other wait. A page whose stamped config has gone
   * stale cannot render its feedback button until the answer comes back, so it
   * asks as soon as the page settles and its engagement follows in a request of
   * its own. Only pages served from something that kept them pay this.
   */
  it("lets a stale page ask early and report engagement separately", async () => {
    const { sent, restore } = recordIngests("/stale-asks");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(TestSigilBrowserProvider);
      await alepha.start();
      // `configAt: 0` is the atom's default: stale by construction, which is
      // exactly what a prerendered page carries.
      provider.testSetDwell(5);

      await (alepha.events as any).emit("react:browser:render", {});
      expect(sent()).toHaveLength(0);

      provider.testLcpArrived();
      expect(sent()).toHaveLength(1);
      expect(sent()[0].views.map((v: any) => v.path)).toEqual(["/stale-asks"]);
      expect(sent()[0].engagements).toBeUndefined();

      await new Promise((r) => setTimeout(r, 25));

      // Ten seconds in rather than fifteen: nothing else is coming for this
      // path, so the row is not made to sit through a debounce window as well.
      expect(sent()).toHaveLength(2);
      expect(sent()[1].engagements.map((e: any) => e.path)).toEqual([
        "/stale-asks",
      ]);
    } finally {
      restore();
    }
  });

  /**
   * LCP is the release signal for one wait only. A fresh page is waiting on the
   * engagement verdict, and the main content having painted says nothing about
   * that. Honouring it here would send the view on its own and leave the
   * verdict to the second request this all exists to remove.
   */
  it("does not let LCP cut short a fresh page's wait", async () => {
    const { sent, restore } = recordIngests("/lcp-no-cut");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(TestSigilBrowserProvider);
      await alepha.start();
      freshConfig(alepha);
      provider.testSetDwell(5);

      await (alepha.events as any).emit("react:browser:render", {});
      provider.testLcpArrived();

      expect(sent()).toHaveLength(0);

      await new Promise((r) => setTimeout(r, 25));

      expect(sent()).toHaveLength(1);
      expect(sent()[0].engagements.map((e: any) => e.path)).toEqual([
        "/lcp-no-cut",
      ]);
    } finally {
      restore();
    }
  });

  /**
   * The verdict is reached whether or not a row is written for it. A page with
   * the views tracker off writes none, and a release that only happened on a
   * written row would leave such a page holding until `pagehide`.
   */
  it("releases the hold on a page that records no engagement", async () => {
    const { sent, restore } = recordIngests("/views-off");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(TestSigilBrowserProvider);
      await alepha.start();
      freshConfig(alepha, { views: false, errors: true, vitals: true });
      provider.testSetDwell(5);

      await (alepha.events as any).emit("react:browser:render", {});
      expect(provider.debugQueueHeld()).toBe(true);

      await new Promise((r) => setTimeout(r, 25));

      // Nothing to say and no reason to say it: a fresh config already knows
      // what it was switched to, so the release is unforced and sends nothing.
      expect(sent()).toHaveLength(0);
      // The hold is lifted all the same, so whatever the page produces next
      // goes back to the ordinary debounce instead of waiting for a `pagehide`.
      expect(provider.debugQueueHeld()).toBe(false);
    } finally {
      restore();
    }
  });

  /**
   * The hook is meant to fire once per load. A second one used to re-hold a
   * queue whose only release point had already been spent, and the page then
   * reported nothing until `pagehide`.
   */
  it("does not re-hold on a second render event", async () => {
    const { sent, restore } = recordIngests("/second-render");
    try {
      const alepha = prodAlepha();
      const provider = alepha.inject(TestSigilBrowserProvider);
      await alepha.start();
      freshConfig(alepha);
      provider.testSetDwell(5);

      await (alepha.events as any).emit("react:browser:render", {});
      await new Promise((r) => setTimeout(r, 25));
      expect(sent()).toHaveLength(1);

      await (alepha.events as any).emit("react:browser:render", {});

      expect(provider.debugQueueHeld()).toBe(false);
    } finally {
      restore();
    }
  });
});
