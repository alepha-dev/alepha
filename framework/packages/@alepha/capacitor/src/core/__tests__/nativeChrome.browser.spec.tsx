import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { $page, ReactRouter } from "alepha/react/router";
import { act } from "react";
import { beforeEach, describe, it } from "vitest";

import {
  AlephaCapacitor,
  BackButtonProvider,
  CapacitorConfigProvider,
  MemoryBackButtonProvider,
  MemoryCapacitorConfigProvider,
  MemorySplashScreenProvider,
  MemoryStatusBarProvider,
  NativeChrome,
  SplashScreenProvider,
  StatusBarProvider,
} from "../index.ts";

class App {
  home = $page({ path: "/", component: () => <p>home</p> });
  notes = $page({ path: "/notes", component: () => <p>notes</p> });
  broken = $page({
    path: "/broken",
    loader: async () => {
      throw new Error("loader broke");
    },
    component: () => <p>never</p>,
  });
}

/**
 * The chrome of an Android shell, whatever jsdom's Capacitor says.
 */
class AndroidChrome extends NativeChrome {
  protected override platform(): string {
    return "android";
  }
}

const boot = async () => {
  const alepha = Alepha.create()
    .with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    })
    .with({ provide: SplashScreenProvider, use: MemorySplashScreenProvider })
    .with({ provide: StatusBarProvider, use: MemoryStatusBarProvider })
    .with({ provide: BackButtonProvider, use: MemoryBackButtonProvider })
    .with({ provide: NativeChrome, use: AndroidChrome })
    .with(AlephaCapacitor)
    .with(AlephaReact)
    .with(App);
  alepha.inject(MemoryCapacitorConfigProvider).config = {
    appId: "dev.alepha.mobile",
    variant: "base",
    scheme: "mobile",
    mode: "bundled",
    env: {},
  };
  // jsdom is not a native platform: the module registers the chrome only
  // inside the shell, so the spec does.
  alepha.inject(NativeChrome);
  await act(async () => {
    await alepha.start();
  });
  await act(async () => {});
  return {
    alepha,
    splash: alepha.inject(MemorySplashScreenProvider),
    statusBar: alepha.inject(MemoryStatusBarProvider),
    back: alepha.inject(MemoryBackButtonProvider),
    router: alepha.inject(ReactRouter),
  };
};

const text = () => document.getElementById("root")?.textContent;

describe("native chrome", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.documentElement.className = "";
    delete document.documentElement.dataset.native;
    document.head.innerHTML =
      '<meta name="viewport" content="width=device-width, initial-scale=1">';
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("marks the document native and covers the viewport", async ({
    expect,
  }) => {
    const { alepha } = await boot();

    expect(document.documentElement.dataset.native).toBe("android");
    expect(
      document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    ).toBe("width=device-width, initial-scale=1, viewport-fit=cover");
    await alepha.stop();
  });

  it("hides the splash once the first screen settles", async ({ expect }) => {
    const { alepha, splash } = await boot();

    expect(text()).toBe("home");
    expect(splash.hides).toBe(1);
    await alepha.stop();
  });

  it("hides the splash on a failed first screen too", async ({ expect }) => {
    window.history.replaceState({}, "", "/broken");

    const { alepha, splash } = await boot();

    expect(splash.hides).toBe(1);
    await alepha.stop();
  });

  it("lets the status bar follow the theme", async ({ expect }) => {
    const { alepha, statusBar } = await boot();
    expect(statusBar.style).toBe("light");

    document.documentElement.classList.add("dark");
    await act(async () => {});
    expect(statusBar.style).toBe("dark");

    document.documentElement.classList.remove("dark");
    await act(async () => {});
    expect(statusBar.style).toBe("light");
    await alepha.stop();
  });
});

describe("the back button", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("runs the handlers last registered first, until one takes the press", async ({
    expect,
  }) => {
    const { alepha, back } = await boot();
    const calls: string[] = [];
    back.register(() => {
      calls.push("first");
      return true;
    });
    const remove = back.register(() => {
      calls.push("overlay");
      return true;
    });

    expect(await back.press()).toBe("handled");
    expect(calls).toEqual(["overlay"]);

    remove();
    expect(await back.press()).toBe("handled");
    expect(calls).toEqual(["overlay", "first"]);
    await alepha.stop();
  });

  it("goes back in the app's history, and exits at its root", async ({
    expect,
  }) => {
    const { alepha, back, router } = await boot();
    // A broken step is skipped, not a trap.
    back.register(() => {
      throw new Error("handler broke");
    });

    expect(router.canGoBack).toBe(false);
    expect(await back.press()).toBe("exit");
    expect(back.exits).toBe(1);

    await act(async () => {
      await router.push("/notes");
    });
    expect(router.canGoBack).toBe(true);

    // history.back() resolves before its popstate: wait for the navigation
    // to land, or React renders after the test environment is gone.
    const popped = new Promise((resolve) =>
      window.addEventListener("popstate", resolve, { once: true }),
    );
    let result: string | undefined;
    await act(async () => {
      result = await back.press();
      await popped;
    });
    await act(async () => {});

    expect(result).toBe("back");
    expect(window.location.pathname).toBe("/");
    expect(back.exits).toBe(1);
    await alepha.stop();
  });
});
