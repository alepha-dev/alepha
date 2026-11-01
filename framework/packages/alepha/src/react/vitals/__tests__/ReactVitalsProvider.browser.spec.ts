import { $hook, $inject, Alepha } from "alepha";
import { describe, it } from "vitest";

import { ReactVitalsProvider } from "../index.ts";

describe("ReactVitalsProvider", () => {
  class TestProvider extends ReactVitalsProvider {
    public get current() {
      return this.path;
    }
  }

  const end = (alepha: Alepha, pathname: string, overlay?: string) =>
    (alepha.events as any).emit("react:transition:end", {
      state: {
        url: new URL(`http://localhost${pathname}`),
        overlay: overlay
          ? { url: new URL(`http://localhost${overlay}`) }
          : undefined,
      },
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

  it("does not emit without a consumer asking for it", async ({ expect }) => {
    const seen: string[] = [];

    class Consumer {
      measured = $hook({
        on: "react:vital:measured",
        handler: ({ metric }) => {
          seen.push(metric);
        },
      });
    }

    const alepha = Alepha.create().with(Consumer);
    await alepha.start();

    expect(seen).toEqual([]);
  });

  it("is what a consumer injects", async ({ expect }) => {
    class Consumer {
      provider = $inject(ReactVitalsProvider);
    }

    const alepha = Alepha.create().with(Consumer);
    await alepha.start();

    expect(alepha.inject(Consumer).provider).toBeInstanceOf(
      ReactVitalsProvider,
    );
  });
});
