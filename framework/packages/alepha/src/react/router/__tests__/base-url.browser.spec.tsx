import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { $page, ReactBrowserProvider, ReactRouter } from "../index.browser.ts";

class App {
  home = $page({ path: "/", component: () => <p>home</p> });
  about = $page({ path: "/about", component: () => <p>about</p> });
}

const boot = async () => {
  const alepha = Alepha.create().with(AlephaReact).with(App);
  await act(async () => {
    await alepha.start();
  });
  await act(async () => {});
  return {
    browser: alepha.inject(ReactBrowserProvider),
    router: alepha.inject(ReactRouter),
  };
};

const text = () => document.getElementById("root")?.textContent;

describe("an app under a Vite base", () => {
  beforeEach(() => {
    // Vite always hands `BASE_URL` over with a trailing slash.
    vi.stubEnv("BASE_URL", "/v1/");
    window.history.replaceState({}, "", "/v1/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState({}, "", "/");
  });

  it("links to a page with a single slash after the base", async ({
    expect,
  }) => {
    const { router } = await boot();

    expect(router.anchor("/about").href).toBe("/v1/about");
  });

  it("pushes a page with a single slash after the base", async ({ expect }) => {
    const { router } = await boot();

    await act(async () => {
      await router.push("/about");
    });

    expect(text()).toBe("about");
    expect(window.location.pathname).toBe("/v1/about");
  });

  it("opens the page the address bar names, under the base", async ({
    expect,
  }) => {
    window.history.replaceState({}, "", "/v1/about");

    const { browser } = await boot();

    expect(browser.url).toBe("/about");
    expect(text()).toBe("about");
  });

  it("opens the home page at the base with and without its slash", async ({
    expect,
  }) => {
    const { browser } = await boot();
    expect(browser.url).toBe("/");

    window.history.replaceState({}, "", "/v1");
    expect(browser.url).toBe("/");
  });

  it("leaves a path that only shares the base's first characters", async ({
    expect,
  }) => {
    const { browser } = await boot();

    window.history.replaceState({}, "", "/v10/about");

    expect(browser.url).toBe("/v10/about");
  });
});
