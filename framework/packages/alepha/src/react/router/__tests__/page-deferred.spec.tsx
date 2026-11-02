import { Alepha, z } from "alepha";
import { AlephaServer } from "alepha/server";
import { Suspense, use } from "react";
import { describe, it } from "vitest";

import { $page, AlephaReactRouter, reactPageCacheOptions } from "../index.ts";

describe("$page deferred values (server)", () => {
  const Slow = (props: { value: Promise<string> }) => (
    <output>{use(props.value)}</output>
  );

  const Page = (props: { value: Promise<string> }) => (
    <main>
      Shell
      <Suspense fallback={<p>Pending</p>}>
        <Slow value={props.value} />
      </Suspense>
    </main>
  );

  class App {
    deferred = $page({
      path: "/deferred",
      schema: { query: z.object({ ms: z.integer().default(100) }) },
      loader: async ({ query }) => ({
        value: new Promise<string>((resolve) => {
          setTimeout(() => resolve("Done"), query.ms);
        }),
      }),
      component: Page,
    });

    buffered = $page({
      path: "/buffered",
      stream: false,
      loader: async () => ({
        value: new Promise<string>((resolve) => {
          setTimeout(() => resolve("Done"), 20);
        }),
      }),
      component: Page,
    });

    clientOnly = $page({
      path: "/client-only",
      ssr: false,
      loader: async () => ({
        value: new Promise<string>((resolve) => {
          setTimeout(() => resolve("Done"), 20);
        }),
      }),
      component: Page,
    });
  }

  const start = async () => {
    const alepha = Alepha.create({
      env: { SERVER_PORT: 0 },
    })
      .with(AlephaServer)
      .with(AlephaReactRouter)
      .with(App);
    await alepha.start();
    return { alepha, app: alepha.inject(App) };
  };

  const payload = (html: string) =>
    JSON.parse(
      html.match(
        /<script id="__ssr" type="application\/json">(.*?)<\/script>/,
      )?.[1] ?? "{}",
    );

  it("writes the shell, then the payload, then the value", async ({
    expect,
  }) => {
    const { alepha, app } = await start();

    const { html } = await app.deferred.fetch({
      html: true,
      query: { ms: "400" },
    });

    const shell = html.indexOf("Pending");
    const data = html.indexOf('id="__ssr"');
    const boot = html.indexOf("alepha:boot");
    const value = html.indexOf("__alephaDeferred");

    expect(shell).toBeGreaterThan(-1);
    expect(data).toBeGreaterThan(shell);
    expect(boot).toBeGreaterThan(data);
    expect(value).toBeGreaterThan(boot);
    expect(html).toContain(">Done<");
    await alepha.stop();
  });

  it("marks a pending value in the payload, never as {}", async ({
    expect,
  }) => {
    const { alepha, app } = await start();

    const { html } = await app.deferred.fetch({
      html: true,
      query: { ms: "400" },
    });
    const layer = payload(html)["alepha.react.router.layers"][0];

    expect(layer.props.value).toEqual({
      $deferred: { status: "pending" },
      id: "1:value",
    });
    await alepha.stop();
  });

  it("never stores a page with a deferred value", async ({ expect }) => {
    const { alepha, app } = await start();
    alepha.store.mut(reactPageCacheOptions, (it) => ({
      ...it,
      anonymousCheck: false,
    }));

    const first = await app.deferred.fetch({ html: true, query: { ms: "1" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await app.deferred.fetch({ html: true, query: { ms: "1" } });

    expect(first.response.headers.get("x-alepha-cache")).toContain("miss");
    expect(second.response.headers.get("x-alepha-cache")).toContain("miss");
    await alepha.stop();
  });

  it("awaits everything for stream: false", async ({ expect }) => {
    const { alepha, app } = await start();

    const { html } = await app.buffered.fetch({ html: true });
    const layer = payload(html)["alepha.react.router.layers"][0];

    expect(html).toContain(">Done<");
    expect(html).not.toContain("Pending");
    expect(layer.props.value.$deferred).toEqual({
      status: "fulfilled",
      value: "Done",
    });
    await alepha.stop();
  });

  it("awaits everything for a prerender", async ({ expect }) => {
    const { alepha, app } = await start();

    const { html } = await app.deferred.render({ html: true });
    const layer = payload(html)["alepha.react.router.layers"][0];

    expect(html).toContain(">Done<");
    expect(html).not.toContain("Pending");
    expect(layer.props.value.$deferred.status).toBe("fulfilled");
    await alepha.stop();
  });

  it("settles a client-rendered page's value into the payload", async ({
    expect,
  }) => {
    const { alepha, app } = await start();

    const { html } = await app.clientOnly.fetch({ html: true });
    const layer = payload(html)["alepha.react.router.layers"][0];

    expect(layer.props.value.$deferred).toEqual({
      status: "fulfilled",
      value: "Done",
    });
    await alepha.stop();
  });
});
