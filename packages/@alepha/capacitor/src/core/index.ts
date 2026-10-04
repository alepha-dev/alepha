import { Capacitor } from "@capacitor/core";
import { $module } from "alepha";
import { ReactAuthTransport } from "alepha/react/auth";

import { AppStateProvider } from "./providers/AppStateProvider.ts";
import { BackButtonProvider } from "./providers/BackButtonProvider.ts";
import { CapacitorConfigProvider } from "./providers/CapacitorConfigProvider.ts";
import { ContentInspector } from "./providers/ContentInspector.ts";
import { DeepLinkProvider } from "./providers/DeepLinkProvider.ts";
import { DeviceProvider } from "./providers/DeviceProvider.ts";
import { HapticsProvider } from "./providers/HapticsProvider.ts";
import { NativeAppStateProvider } from "./providers/NativeAppStateProvider.ts";
import { NativeAuthTransport } from "./providers/NativeAuthTransport.ts";
import { NativeBackButtonProvider } from "./providers/NativeBackButtonProvider.ts";
import { NativeDeepLinkProvider } from "./providers/NativeDeepLinkProvider.ts";
import { NativeDeviceProvider } from "./providers/NativeDeviceProvider.ts";
import { NativeHapticsProvider } from "./providers/NativeHapticsProvider.ts";
import { NativeSplashScreenProvider } from "./providers/NativeSplashScreenProvider.ts";
import { NativeStatusBarProvider } from "./providers/NativeStatusBarProvider.ts";
import { NativeTokenStorageProvider } from "./providers/NativeTokenStorageProvider.ts";
import { SplashScreenProvider } from "./providers/SplashScreenProvider.ts";
import { StatusBarProvider } from "./providers/StatusBarProvider.ts";
import { TokenStorageProvider } from "./providers/TokenStorageProvider.ts";
import { WebContentProvider } from "./providers/WebContentProvider.ts";
import { NativeChrome } from "./services/NativeChrome.ts";
import { NativeSession } from "./services/NativeSession.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./interfaces/DeepLink.ts";
export * from "./interfaces/DeviceInfo.ts";
export * from "./interfaces/WebContent.ts";
export * from "./providers/AppStateProvider.ts";
export * from "./providers/BackButtonProvider.ts";
export * from "./providers/CapacitorConfigProvider.ts";
export * from "./providers/ContentInspector.ts";
export * from "./providers/DeepLinkProvider.ts";
export * from "./providers/DeviceProvider.ts";
export * from "./providers/HapticsProvider.ts";
export * from "./providers/MemoryAppStateProvider.ts";
export * from "./providers/MemoryBackButtonProvider.ts";
export * from "./providers/MemoryCapacitorConfigProvider.ts";
export * from "./providers/MemoryContentInspector.ts";
export * from "./providers/MemoryDeepLinkProvider.ts";
export * from "./providers/MemoryDeviceProvider.ts";
export * from "./providers/MemoryHapticsProvider.ts";
export * from "./providers/MemorySplashScreenProvider.ts";
export * from "./providers/MemoryStatusBarProvider.ts";
export * from "./providers/MemoryTokenStorageProvider.ts";
export * from "./providers/MemoryWebContentProvider.ts";
export * from "./providers/NativeAppStateProvider.ts";
export * from "./providers/NativeAuthTransport.ts";
export * from "./providers/NativeBackButtonProvider.ts";
export * from "./providers/NativeDeepLinkProvider.ts";
export * from "./providers/NativeDeviceProvider.ts";
export * from "./providers/NativeHapticsProvider.ts";
export * from "./providers/NativeSplashScreenProvider.ts";
export * from "./providers/NativeStatusBarProvider.ts";
export * from "./providers/NativeTokenStorageProvider.ts";
export * from "./providers/SplashScreenProvider.ts";
export * from "./providers/StatusBarProvider.ts";
export * from "./providers/TokenStorageProvider.ts";
export * from "./providers/WebContentProvider.ts";
export * from "./schemas/capacitorPublicConfigSchema.ts";
export * from "./services/NativeChrome.ts";
export * from "./services/NativeSession.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * The app moved to the foreground (`active: true`) or the background.
     */
    "capacitor:app:state": {
      active: boolean;
    };
    /**
     * A native sign-out finished. `revoked` is false when the server could
     * not confirm the session was revoked; the device is signed out either
     * way.
     */
    "capacitor:auth:signout": {
      revoked: boolean;
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
 *   {@link StatusBarProvider};
 * - {@link DeepLinkProvider}: `<scheme>://app/<path>` links, cold and warm;
 * - {@link BackButtonProvider}: the Android back button as a chain of
 *   handlers, then the router's history, then exit;
 * - natively, {@link NativeChrome}: `data-native` on `<html>`, the splash
 *   hidden on the first settled screen ({@link SplashScreenProvider}), the
 *   status bar following the theme;
 * - natively, {@link NativeAuthTransport}: `ReactAuth` signs in against the
 *   API with a password and keeps the session in secure storage
 *   ({@link TokenStorageProvider}) as a Bearer token. Register this module
 *   before the one importing `AlephaReactAuth`.
 *
 * Each has a `Memory*` implementation for specs: substitute it before this
 * module is registered.
 *
 * There is no native navigation plugin: tabs, stacks and transitions are the
 * `$page` router's, in the DOM, with the platform's chrome around them (status
 * bar, splash, safe areas, back button, haptics). An adopting product reopens
 * that choice only after two App Store guideline 4.2 rejections.
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
      alepha.with({ provide: DeepLinkProvider, use: NativeDeepLinkProvider });
      alepha.with({
        provide: SplashScreenProvider,
        use: NativeSplashScreenProvider,
      });
      alepha.with({
        provide: BackButtonProvider,
        use: NativeBackButtonProvider,
      });
      alepha.with(NativeChrome);
      alepha.with({
        provide: TokenStorageProvider,
        use: NativeTokenStorageProvider,
      });
      // Token custody: register this module before AlephaReactAuth (the app's
      // web module), so ReactAuth is built with this transport.
      alepha.with({ provide: ReactAuthTransport, use: NativeAuthTransport });
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
    TokenStorageProvider,
    NativeSession,
    DeepLinkProvider,
    SplashScreenProvider,
    BackButtonProvider,
  ],
});
