import { $atom, $inject, Alepha, z } from "alepha";
import { ServerProvider } from "alepha/server";
import { MemoryTraceProvider } from "alepha/tracing";
import { describe, it } from "vitest";

import NestedView from "../components/NestedView.tsx";
import { AlephaReactRouter } from "../index.ts";
import { $page } from "../primitives/$page.ts";

const flag = $atom({
  name: "test.tracing.flag",
  schema: z.text(),
  default: "unset",
});

/**
 * SSR under tracing (#E86): one span per `$page` loader and one for the
 * render, under the request root, and a loader's writes survive its span.
 */
describe("$page tracing", () => {
  it("opens a loader span per layer and a render span under the request root", async ({
    expect,
  }) => {
    class App {
      alepha = $inject(Alepha);
      layout = $page({
        name: "layout",
        children: () => [this.home],
        loader: () => ({ section: "main" }),
        component: () => <NestedView />,
      });
      home = $page({
        name: "home",
        path: "/",
        loader: () => {
          this.alepha.store.set(flag, "set-by-loader");
          return { greeting: "hello" };
        },
        component: () => this.alepha.store.get(flag),
      });
    }

    const alepha = Alepha.create({
      env: { SERVER_PORT: 0, APP_SECRET: "test-secret" },
    }).with(AlephaReactRouter);
    alepha.inject(App);
    const traces = alepha.inject(MemoryTraceProvider);
    await alepha.start();

    const res = await fetch(`${alepha.inject(ServerProvider).hostname}/`);
    const html = await res.text();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The atom a traced loader set is still there for the render.
    expect(html).toContain("set-by-loader");

    const root = traces
      .spans()
      .find((s) => s.kind === "server" && s.name.startsWith("GET "))!;
    expect(root).toBeDefined();
    const names = traces.children(root).map((s) => s.name);
    expect(names).toEqual(["loader layout", "loader home", "render home"]);
  });
});
