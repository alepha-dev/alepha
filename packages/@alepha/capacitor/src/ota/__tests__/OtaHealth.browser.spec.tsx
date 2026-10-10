import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { $page, reactBootOptions } from "alepha/react/router";
import { act } from "react";
import { beforeEach, describe, it } from "vitest";

import {
  AlephaCapacitor,
  CapacitorConfigProvider,
  MemoryCapacitorConfigProvider,
} from "../../core/index.ts";
import {
  AlephaCapacitorOta,
  MemoryUpdaterAdapter,
  OtaProvider,
  UpdaterAdapter,
} from "../index.ts";

class App {
  home = $page({ path: "/", component: () => <p>home</p> });
  offline = $page({
    path: "/notes",
    // The API cannot be reached: a network error, the offline screen.
    loader: async () => {
      throw new TypeError("Failed to fetch");
    },
    component: () => <p>notes</p>,
  });
  stalled = $page({
    path: "/stalled",
    // The API never answers: the boot deadline, the offline screen.
    loader: () => new Promise(() => {}),
    component: () => <p>never</p>,
  });
  broken = $page({
    path: "/broken",
    component: () => {
      throw new Error("render broke");
    },
  });
}

class NativeOtaProvider extends OtaProvider {
  protected override isNative(): boolean {
    return true;
  }
}

/**
 * A real boot of a bundled shell: React renders, the router settles the
 * first screen, and the provider acknowledges (or not) on that signal.
 */
const boot = async (path: string) => {
  window.history.replaceState({}, "", path);
  const alepha = Alepha.create()
    .with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    })
    .with({ provide: UpdaterAdapter, use: MemoryUpdaterAdapter })
    .with({ provide: OtaProvider, use: NativeOtaProvider })
    .with(AlephaCapacitor)
    .with(AlephaCapacitorOta)
    .with(AlephaReact)
    .with(App);
  alepha.inject(MemoryCapacitorConfigProvider).config = {
    appId: "dev.alepha.mobile",
    variant: "base",
    scheme: "mobile",
    mode: "bundled",
    ota: { url: "https://api.test" },
    env: {},
  };
  // A short boot deadline, so the stalled case settles fast.
  alepha.store.mut(reactBootOptions, (options) => ({
    ...options,
    deadline: 100,
  }));
  const updater = alepha.inject(MemoryUpdaterAdapter);
  await act(async () => {
    await alepha.start();
  });
  await act(async () => {});
  return { alepha, updater };
};

describe("OTA acknowledgment on a real boot", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("acknowledges a page", async ({ expect }) => {
    const { alepha, updater } = await boot("/");
    expect(document.getElementById("root")?.textContent).toBe("home");
    expect(updater.acknowledged).toBe(1);
    await alepha.stop();
  });

  it("acknowledges the offline screen, without waiting for the API", async ({
    expect,
  }) => {
    const { alepha, updater } = await boot("/notes");
    expect(document.getElementById("root")?.textContent).not.toContain("notes");
    expect(updater.acknowledged).toBe(1);
    await alepha.stop();
  });

  it("acknowledges the offline screen when the API never answers", async ({
    expect,
  }) => {
    const { alepha, updater } = await boot("/stalled");
    expect(updater.acknowledged).toBe(1);
    await alepha.stop();
  });

  it("never acknowledges a render that crashed", async ({ expect }) => {
    const { alepha, updater } = await boot("/broken");
    expect(updater.acknowledged).toBe(0);
    await alepha.stop();
  });
});
