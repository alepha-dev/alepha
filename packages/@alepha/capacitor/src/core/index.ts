import { Capacitor } from "@capacitor/core";
import { $module } from "alepha";

import { AppStateProvider } from "./providers/AppStateProvider.ts";
import { CapacitorConfigProvider } from "./providers/CapacitorConfigProvider.ts";
import { ContentInspector } from "./providers/ContentInspector.ts";
import { DeviceProvider } from "./providers/DeviceProvider.ts";
import { HapticsProvider } from "./providers/HapticsProvider.ts";
import { NativeAppStateProvider } from "./providers/NativeAppStateProvider.ts";
import { NativeDeviceProvider } from "./providers/NativeDeviceProvider.ts";
import { NativeHapticsProvider } from "./providers/NativeHapticsProvider.ts";
import { NativeStatusBarProvider } from "./providers/NativeStatusBarProvider.ts";
import { StatusBarProvider } from "./providers/StatusBarProvider.ts";
import { WebContentProvider } from "./providers/WebContentProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./interfaces/DeviceInfo.ts";
export * from "./interfaces/WebContent.ts";
export * from "./providers/AppStateProvider.ts";
export * from "./providers/CapacitorConfigProvider.ts";
export * from "./providers/ContentInspector.ts";
export * from "./providers/DeviceProvider.ts";
export * from "./providers/HapticsProvider.ts";
export * from "./providers/MemoryAppStateProvider.ts";
export * from "./providers/MemoryCapacitorConfigProvider.ts";
export * from "./providers/MemoryContentInspector.ts";
export * from "./providers/MemoryDeviceProvider.ts";
export * from "./providers/MemoryHapticsProvider.ts";
export * from "./providers/MemoryStatusBarProvider.ts";
export * from "./providers/MemoryWebContentProvider.ts";
export * from "./providers/NativeAppStateProvider.ts";
export * from "./providers/NativeDeviceProvider.ts";
export * from "./providers/NativeHapticsProvider.ts";
export * from "./providers/NativeStatusBarProvider.ts";
export * from "./providers/StatusBarProvider.ts";
export * from "./providers/WebContentProvider.ts";
export * from "./schemas/capacitorPublicConfigSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * The app moved to the foreground (`active: true`) or the background.
     */
    "capacitor:app:state": {
      active: boolean;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Native capabilities for an Alepha app running in a Capacitor shell.
 *
 * Import this module in the app's browser entry. Inside the native shell it
 * binds the native implementations; in a plain browser, web fallbacks; so
 * the same app code runs on both, and app code never imports `@capacitor/*`.
 *
 * - {@link CapacitorConfigProvider}: the shell's public configuration, and
 *   every host-less `$client` pointed at its API;
 * - {@link WebContentProvider}: which web layer is running (bundled, dev, or
 *   a live update through a substituted {@link ContentInspector});
 * - {@link HapticsProvider}, {@link AppStateProvider}, {@link DeviceProvider},
 *   {@link StatusBarProvider}.
 *
 * Each has a `Memory*` implementation for specs: substitute it before this
 * module is registered.
 *
 * The shell and its native projects are made by `@alepha/capacitor/cli`.
 *
 * @module alepha.capacitor
 */
export const AlephaCapacitor = $module({
  name: "alepha.capacitor",
  register: (alepha) => {
    // A substitution a spec made earlier wins: the first one recorded is the
    // one kept.
    if (Capacitor.isNativePlatform()) {
      alepha.with({ provide: HapticsProvider, use: NativeHapticsProvider });
      alepha.with({ provide: AppStateProvider, use: NativeAppStateProvider });
      alepha.with({ provide: DeviceProvider, use: NativeDeviceProvider });
      alepha.with({ provide: StatusBarProvider, use: NativeStatusBarProvider });
    }
  },
  services: [
    CapacitorConfigProvider,
    ContentInspector,
    WebContentProvider,
    HapticsProvider,
    AppStateProvider,
    DeviceProvider,
    StatusBarProvider,
  ],
});
