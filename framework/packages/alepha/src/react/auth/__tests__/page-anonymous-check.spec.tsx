import { randomUUID } from "node:crypto";

import { $hook, $inject, Alepha } from "alepha";
import {
  $page,
  AlephaReactRouter,
  ReactPageCacheProvider,
  reactPageCacheOptions,
} from "alepha/react/router";
import { $issuer, AlephaSecurity } from "alepha/security";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaReactAuth } from "../index.ts";

/**
 * The anonymous double render (#E78): outside production, a page about to be
 * cached is rendered again for nobody, and a difference refuses the write.
 * It catches what the read tracker cannot see.
 */
describe("anonymous double-render check", () => {
  /**
   * A hidden channel: a service field written from the raw request in a
   * hook, then printed by a component. No atom, no tracked read.
   */
  class Greeter {
    public name = "nobody";

    protected readonly onRender = $hook({
      on: "react:server:render:begin",
      handler: ({ request }) => {
        this.name =
          (request as { user?: { id: string } })?.user?.id ?? "nobody";
      },
    });
  }

  const boot = async () => {
    let loads = 0;

    class App {
      protected readonly greeter = $inject(Greeter);

      realm = $issuer({
        secret: "anonymous-check-secret",
        roles: [{ name: "user", permissions: [{ name: "*" }] }],
      });

      hello = $page({
        path: "/hello",
        stream: false,
        component: () => `hello ${this.greeter.name}`,
      });

      lucky = $page({
        path: "/lucky",
        component: () => `lucky ${Math.random()}`,
      });

      plain = $page({
        path: "/plain",
        loader: () => {
          loads++;
          return { n: 1 };
        },
        component: () => "plain",
      });
    }

    const alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaSecurity)
      .with(AlephaReactAuth)
      .with(Greeter)
      .with(App);
    const app = alepha.inject(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;

    const visit = async (path: string, token?: string) => {
      const res = await fetch(`${base}${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const body = await res.text();
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { body, cache: res.headers.get("x-alepha-cache") ?? "" };
    };

    return {
      alepha,
      visit,
      loads: () => loads,
      token: async () =>
        (await app.realm.createToken({ id: randomUUID(), roles: ["user"] }))
          .access_token,
      pageCache: alepha.inject(ReactPageCacheProvider),
    };
  };

  it("refuses a page whose markup carries the visitor through a hidden channel", async ({
    expect,
  }) => {
    const { visit, token, pageCache } = await boot();
    const alice = await token();

    const first = await visit("/hello", alice);

    // The tracker saw nothing personal, so the page was about to be cached
    // with Alice's id in it; the anonymous render said "nobody".
    expect(first.body).not.toContain("hello nobody");
    expect(first.cache).toBe("refused");
    expect(pageCache.size).toBe(0);

    const anonymous = await visit("/hello");
    expect(anonymous.body).toContain("hello nobody");
    expect(anonymous.body).not.toContain(first.body.match(/hello ([^<]+)/)![1]);
  });

  it("refuses a page that prints a random value, and says so on the next request", async ({
    expect,
  }) => {
    const { visit, pageCache } = await boot();

    await visit("/lucky");
    const second = await visit("/lucky");

    expect(pageCache.size).toBe(0);
    expect(second.cache).toBe("refused");
  });

  it("writes a deterministic page, running its loader twice on the first miss", async ({
    expect,
  }) => {
    const { visit, loads } = await boot();

    await visit("/plain");
    const second = await visit("/plain");

    expect(second.cache).toBe("hit; verdict=shared");
    expect(loads()).toBe(2);
  });

  it("can be switched off, and then caches what it would have refused", async ({
    expect,
  }) => {
    const { visit, alepha } = await boot();
    alepha.store.mut(reactPageCacheOptions, (it) => ({
      ...it,
      anonymousCheck: false,
    }));

    await visit("/lucky");

    expect((await visit("/lucky")).cache).toBe("hit; verdict=shared");
  });
});
