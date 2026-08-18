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
