import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { sigilClientAtom } from "../../shared/sigilClientAtom.ts";
import { SigilBrowserProvider } from "../SigilBrowserProvider.ts";

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
    await (alepha.events as any).emit("react:transition:end", {
      state: { url: { pathname: "/dash" } },
    });
    expect(provider.debugPendingViews()).toContain("/dash");
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
    // Blights-only sigil: beacon disabled → no view collected.
    alepha.store.set(sigilClientAtom, {
      features: ["blights"],
      excludedPaths: [],
    });
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
});
