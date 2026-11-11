import { $inject, Alepha, type AppSurface } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaReactRouter, NestedView } from "../index.ts";
import { $page } from "../primitives/$page.ts";
import { ReactPageProvider } from "../providers/ReactPageProvider.ts";

/**
 * Pure page routers are created on the first page request (#Q3405): a cron
 * or an API request never pays for the page tree, and the first page request
 * creates every declared router at once, builds the tree and answers.
 */
let created: string[] = [];

class LayoutRouter {
  constructor() {
    created.push("LayoutRouter");
  }
  layout = $page({
    children: () => [this.home, this.about],
    component: () => <NestedView />,
  });
  home = $page({ path: "/", component: () => "home page" });
  about = $page({ path: "/about", component: () => "about page" });
}

class DocsRouter {
  shell = $inject(LayoutRouter);
  constructor() {
    created.push("DocsRouter");
  }
  docs = $page({
    path: "/docs",
    parent: this.shell.layout,
    component: () => "docs page",
  });
}

class Api {
  ping = $action({ method: "GET", path: "/ping", handler: () => "pong" });
}

const row = (name: string, cls: string) => ({ name, class: cls });

const surface: AppSurface = {
  version: 1,
  classes: [
    { key: "LayoutRouter", pure: true },
    { key: "DocsRouter", pure: true },
  ],
  actions: [],
  routes: [],
  pages: [
    row("layout", "LayoutRouter"),
    row("home", "LayoutRouter"),
    row("about", "LayoutRouter"),
    row("docs", "DocsRouter"),
  ],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
};

const start = async (list = true) => {
  created = [];
  const alepha = Alepha.create({
    env: { SERVER_PORT: 0, APP_SECRET: "test-secret" },
  });
  if (list) {
    alepha.useSurface(surface);
  }
  alepha.with(AlephaReactRouter).with(Api).with(LayoutRouter).with(DocsRouter);
  await alepha.start();
  const hostname = alepha.inject(ServerProvider).hostname;
  return {
    alepha,
    request: (path: string) => fetch(`${hostname}${path}`, { redirect: "manual" }),
  };
};

describe("pure page routers", () => {
  it("are not created at boot, nor by an API request", async ({ expect }) => {
    const { alepha, request } = await start();
    expect(created).toEqual([]);
    expect(await (await request("/api/ping")).text()).toBe("pong");
    expect(created).toEqual([]);
    await alepha.stop();
  });

  it("are created by the first page request, all at once, and answer it", async ({
    expect,
  }) => {
    const { alepha, request } = await start();
    const first = await request("/docs");
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("docs page");
    expect([...created].sort()).toEqual(["DocsRouter", "LayoutRouter"]);

    const second = await request("/about");
    expect(await second.text()).toContain("about page");
    expect(created).toHaveLength(2);
    await alepha.stop();
  });

  it("keep 404 and the not-found page as before", async ({ expect }) => {
    const { alepha, request } = await start();
    const missing = await request("/nowhere");
    expect(missing.status).toBe(404);
    await alepha.stop();
  });

  it("answer router.path for a page whose router does not exist yet", async ({
    expect,
  }) => {
    const { alepha } = await start();
    expect(alepha.inject(ReactPageProvider).pathname("docs")).toBe("/docs");
    await alepha.stop();
  });

  it("are created at boot without a list", async ({ expect }) => {
    const { alepha, request } = await start(false);
    expect([...created].sort()).toEqual(["DocsRouter", "LayoutRouter"]);
    expect(await (await request("/docs")).text()).toContain("docs page");
    await alepha.stop();
  });
});
