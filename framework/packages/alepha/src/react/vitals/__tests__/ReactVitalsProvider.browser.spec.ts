import { Alepha } from "alepha";
import { AlephaReactRouter, type ReactRouterState } from "alepha/react/router";
import { describe, it } from "vitest";

import { ReactVitalsProvider } from "../index.ts";

describe("ReactVitalsProvider", () => {
  class TestProvider extends ReactVitalsProvider {
    public get current() {
      return this.path;
    }
  }

  const end = (alepha: Alepha, pathname: string, overlay?: string) =>
    alepha.events.emit("react:transition:end", {
      state: {
        url: new URL(`http://localhost${pathname}`),
        overlay: overlay
          ? { url: new URL(`http://localhost${overlay}`) }
          : undefined,
      } as ReactRouterState,
    });

  it("follows the router, to the overlay's URL when one is open", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const provider = alepha.inject(TestProvider);
    await alepha.start();

    await end(alepha, "/a");
    expect(provider.current).toBe("/a");

    await end(alepha, "/a", "/cards/1");
    expect(provider.current).toBe("/cards/1");
  });

  it("is opt-in: the router does not register it", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    await alepha.start();

    expect(alepha.has(ReactVitalsProvider)).toBe(false);
  });
});
