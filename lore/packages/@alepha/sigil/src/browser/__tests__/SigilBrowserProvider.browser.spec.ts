import { describe, expect, it } from "vitest";
import { Alepha } from "alepha";
import { SigilBrowserProvider } from "../SigilBrowserProvider.ts";

describe("SigilBrowserProvider", () => {
  it("enqueues a pageview on react:transition:end (prod + browser)", async () => {
    const alepha = Alepha.create({ env: { NODE_ENV: "production", SERVER_PORT: 0 } });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    await (alepha.events as any).emit("react:transition:end", { state: { url: { pathname: "/dash" } } });
    expect(provider.debugPendingViews()).toContain("/dash");
  });

  it("is inert in dev (no queue built)", async () => {
    const alepha = Alepha.create({ env: { NODE_ENV: "development" } });
    const provider = alepha.inject(SigilBrowserProvider);
    await alepha.start();
    await (alepha.events as any).emit("react:transition:end", { state: { url: { pathname: "/x" } } });
    expect(provider.debugPendingViews()).toEqual([]);
  });
});
