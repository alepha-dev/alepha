import { $hook, Alepha, z } from "alepha";
import { $action } from "alepha/server";
import { AlephaServerLinksClient, LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import {
  AlephaCapacitor,
  AppStateProvider,
  CapacitorConfigProvider,
  DeviceProvider,
  HapticsProvider,
  MemoryCapacitorConfigProvider,
  StatusBarProvider,
  WebContentProvider,
} from "../index.ts";

const shellConfig = {
  appId: "dev.alepha.mobile",
  variant: "base",
  scheme: "mobile",
  mode: "bundled" as const,
  apiUrl: "https://api.test",
  env: {},
};

class Api {
  hello = $action({
    schema: { response: z.text() },
    handler: () => "hi",
  });
}

class Probe {
  public urls: string[] = [];
  public states: boolean[] = [];

  protected readonly onFetch = $hook({
    on: "client:beforeFetch",
    handler: ({ url }) => {
      this.urls.push(url);
    },
  });

  protected readonly onState = $hook({
    on: "capacitor:app:state",
    handler: ({ active }) => {
      this.states.push(active);
    },
  });
}

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("@alepha/capacitor/core in a browser", () => {
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("follows the document's visibility, until the container stops", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaCapacitor).with(Probe);
    await alepha.start();
    const probe = alepha.inject(Probe);

    setVisibility("hidden");
    await Promise.resolve();
    setVisibility("visible");
    await Promise.resolve();
    expect(probe.states).toEqual([false, true]);
    expect(alepha.inject(AppStateProvider).isActive()).toBe(true);

    await alepha.stop();
    setVisibility("hidden");
    await Promise.resolve();
    expect(probe.states).toEqual([false, true]);
  });

  it("says only what a browser knows about the device", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCapacitor);

    const info = await alepha.inject(DeviceProvider).info();

    expect(info.platform).toBe("web");
    expect(info.userAgent).toBe(navigator.userAgent);
  });

  it("does nothing for haptics or the status bar on the web", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaCapacitor);

    await expect(
      alepha.inject(HapticsProvider).impact("heavy"),
    ).resolves.toBeUndefined();
    await expect(
      alepha.inject(StatusBarProvider).setStyle("dark"),
    ).resolves.toBeUndefined();
  });

  it("reports a shell's content with the page's origin", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    });
    alepha.inject(MemoryCapacitorConfigProvider).config = shellConfig;
    alepha.with(AlephaCapacitor);

    expect(await alepha.inject(WebContentProvider).content()).toEqual({
      mode: "bundled",
      origin: window.location.origin,
    });
  });

  it("sends a shell's host-less calls to its API, never batched, never relative", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({
        provide: CapacitorConfigProvider,
        use: MemoryCapacitorConfigProvider,
      })
      .with(AlephaServerLinksClient)
      .with(Probe);
    alepha.inject(MemoryCapacitorConfigProvider).config = shellConfig;
    alepha.with(AlephaCapacitor);
    await alepha.start();

    await alepha
      .inject(LinkProvider)
      .client<Api>()
      .hello({})
      .catch(() => undefined);

    expect(alepha.inject(Probe).urls).toEqual(["https://api.test/api/_links"]);
  });
});
