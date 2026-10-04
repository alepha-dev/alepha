import { $hook, Alepha } from "alepha";
import { linkOptionsAtom } from "alepha/server/links";
import { describe, it } from "vitest";

import {
  AlephaCapacitor,
  AppStateProvider,
  CapacitorConfigProvider,
  ContentInspector,
  DeviceProvider,
  HapticsProvider,
  MemoryAppStateProvider,
  MemoryCapacitorConfigProvider,
  MemoryContentInspector,
  MemoryDeviceProvider,
  MemoryHapticsProvider,
  MemoryStatusBarProvider,
  MemoryWebContentProvider,
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

class StateProbe {
  public events: boolean[] = [];

  protected readonly onState = $hook({
    on: "capacitor:app:state",
    handler: ({ active }) => {
      this.events.push(active);
    },
  });
}

describe("AlephaCapacitor", () => {
  it("binds the web implementations outside a native shell", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCapacitor);

    expect(alepha.inject(HapticsProvider).constructor).toBe(HapticsProvider);
    expect(alepha.inject(StatusBarProvider).constructor).toBe(
      StatusBarProvider,
    );
  });

  it("keeps a memory implementation substituted before it", ({ expect }) => {
    const alepha = Alepha.create()
      .with({ provide: HapticsProvider, use: MemoryHapticsProvider })
      .with(AlephaCapacitor);

    expect(alepha.inject(HapticsProvider)).toBeInstanceOf(
      MemoryHapticsProvider,
    );
  });
});

describe("CapacitorConfigProvider", () => {
  it("points host-less clients at the shell's API", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    });
    alepha.inject(MemoryCapacitorConfigProvider).config = shellConfig;
    alepha.with(AlephaCapacitor);

    await alepha.start();

    expect(alepha.store.get(linkOptionsAtom).hostname).toBe("https://api.test");
  });

  it("leaves a web build alone", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCapacitor);

    await alepha.start();

    expect(alepha.inject(CapacitorConfigProvider).isShell()).toBe(false);
    expect(alepha.store.get(linkOptionsAtom).hostname).toBeUndefined();
  });
});

describe("WebContentProvider", () => {
  it("reports nothing outside a shell", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaCapacitor);

    expect(await alepha.inject(WebContentProvider).content()).toBeUndefined();
  });

  it("reports the build's own mode from the public config", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    });
    alepha.inject(MemoryCapacitorConfigProvider).config = {
      ...shellConfig,
      mode: "dev",
    };
    alepha.with(AlephaCapacitor);

    expect((await alepha.inject(WebContentProvider).content())?.mode).toBe(
      "dev",
    );
  });

  it("reports ota through a substituted inspector, with no updater imported", async ({
    expect,
  }) => {
    // The seam a live updater fills: core asks the inspector, never the
    // updater.
    const alepha = Alepha.create().with({
      provide: ContentInspector,
      use: MemoryContentInspector,
    });
    alepha.inject(MemoryContentInspector).content = {
      mode: "ota",
      bundleVersion: "1.4.0",
    };
    alepha.with(AlephaCapacitor);

    expect(await alepha.inject(WebContentProvider).content()).toMatchObject({
      mode: "ota",
      bundleVersion: "1.4.0",
    });
  });

  it("has a memory implementation for every mode", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: WebContentProvider,
      use: MemoryWebContentProvider,
    });
    const memory = alepha.inject(MemoryWebContentProvider);

    for (const mode of ["bundled", "dev", "ota"] as const) {
      memory.current = { mode, origin: "capacitor://localhost" };
      expect((await alepha.inject(WebContentProvider).content())?.mode).toBe(
        mode,
      );
    }
  });
});

describe("memory providers", () => {
  it("records haptics", async ({ expect }) => {
    const haptics = Alepha.create().inject(MemoryHapticsProvider);

    await haptics.impact("light");
    await haptics.notification("success");
    await haptics.selection();

    expect(haptics.calls).toEqual([
      "impact:light",
      "notification:success",
      "selection",
    ]);
  });

  it("moves the app state, emits it, and stops listening on stop", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: AppStateProvider, use: MemoryAppStateProvider })
      .with(AlephaCapacitor)
      .with(StateProbe);
    await alepha.start();
    const state = alepha.inject(MemoryAppStateProvider);
    expect(state.listening).toBe(true);

    await state.setActive(false);
    await state.setActive(false);
    await state.setActive(true);

    expect(alepha.inject(StateProbe).events).toEqual([false, true]);
    await alepha.stop();
    expect(state.listening).toBe(false);
  });

  it("describes a device", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: DeviceProvider,
      use: MemoryDeviceProvider,
    });

    expect((await alepha.inject(DeviceProvider).info()).platform).toBe("ios");
  });

  it("records the status bar", async ({ expect }) => {
    const bar = Alepha.create().inject(MemoryStatusBarProvider);

    await bar.setStyle("dark");
    await bar.hide();

    expect(bar.style).toBe("dark");
    expect(bar.visible).toBe(false);
  });
});
