# Alepha @alepha/capacitor

Native iOS and Android apps for Alepha: a Capacitor shell, native capabilities behind DI providers, and the alepha capacitor commands.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/capacitor
```

## Module

Native capabilities for an Alepha app running in a Capacitor shell.

Import this module in the app's browser entry. Inside the native shell it
binds the native implementations; in a plain browser, web fallbacks; so
the same app code runs on both, and app code never imports `@capacitor/*`.

- `CapacitorConfigProvider`: the shell's public configuration, and
  every host-less `$client` pointed at its API;
- `WebContentProvider`: which web layer is running (bundled, dev, or
  a live update through a substituted `ContentInspector`);
- `HapticsProvider`, `AppStateProvider`, `DeviceProvider`,
  `StatusBarProvider`;
- `DeepLinkProvider`: `<scheme>://app/<path>` links, cold and warm;
- `BackButtonProvider`: the Android back button as a chain of
  handlers, then the router's history, then exit;
- natively, `NativeChrome`: `data-native` on `<html>`, the splash
  hidden on the first settled screen (`SplashScreenProvider`), the
  status bar following the theme;
- natively, `NativeAuthTransport`: `ReactAuth` signs in against the
  API with a password and keeps the session in secure storage
  (`TokenStorageProvider`) as a Bearer token. Register this module
  before the one importing `AlephaReactAuth`.

Each has a `Memory*` implementation for specs: substitute it before this
module is registered.

There is no native navigation plugin: tabs, stacks and transitions are the
`$page` router's, in the DOM, with the platform's chrome around them (status
bar, splash, safe areas, back button, haptics). An adopting product reopens
that choice only after two App Store guideline 4.2 rejections.

The shell and its native projects are made by `@alepha/capacitor/cli`.

## API Reference

### Providers

- [`AppStateProvider`](https://alepha.dev/docs/reference-providers-appstateprovider) - Whether the app is in the foreground, and the event when that changes.
- [`BackButtonProvider`](https://alepha.dev/docs/reference-providers-backbuttonprovider) - The Android back button, as a chain rather than a registry of overlays.
- [`CapacitorConfigProvider`](https://alepha.dev/docs/reference-providers-capacitorconfigprovider) - The public configuration of a native shell, as its build baked it.
- [`ContentInspector`](https://alepha.dev/docs/reference-providers-contentinspector) - Answers which web layer is running, for `WebContentProvider`.
- [`DeepLinkProvider`](https://alepha.dev/docs/reference-providers-deeplinkprovider) - Custom-scheme deep links: `<scheme>://app/<path>?query#hash` opens that
- [`DeviceProvider`](https://alepha.dev/docs/reference-providers-deviceprovider) - What the app runs on. The web implementation (this class) says only what a
- [`HapticsProvider`](https://alepha.dev/docs/reference-providers-hapticsprovider) - Touch feedback. A no-op on the web, where there is nothing to vibrate
- [`MemoryAppStateProvider`](https://alepha.dev/docs/reference-providers-memoryappstateprovider) - An app state a spec moves by hand.
- [`MemoryBackButtonProvider`](https://alepha.dev/docs/reference-providers-memorybackbuttonprovider) - Records the exits a spec's presses caused, instead of closing anything.
- [`MemoryCapacitorConfigProvider`](https://alepha.dev/docs/reference-providers-memorycapacitorconfigprovider) - A shell configuration set by hand, for specs. `undefined` is a web build.
- [`MemoryContentInspector`](https://alepha.dev/docs/reference-providers-memorycontentinspector) - An inspector answering whatever a spec sets, `ota` included: the seam a
- [`MemoryDeepLinkProvider`](https://alepha.dev/docs/reference-providers-memorydeeplinkprovider) - Deep links a spec plays: a launch URL, and links opened later.
- [`MemoryDeviceProvider`](https://alepha.dev/docs/reference-providers-memorydeviceprovider) - A device a spec describes.
- [`MemoryHapticsProvider`](https://alepha.dev/docs/reference-providers-memoryhapticsprovider) - Records every haptic a spec triggered.
- [`MemorySplashScreenProvider`](https://alepha.dev/docs/reference-providers-memorysplashscreenprovider) - Counts the hides a spec caused.
- [`MemoryStatusBarProvider`](https://alepha.dev/docs/reference-providers-memorystatusbarprovider) - Records what a spec asked of the status bar.
- [`MemoryTokenStorageProvider`](https://alepha.dev/docs/reference-providers-memorytokenstorageprovider) - Session tokens in a map, for specs.
- [`MemoryWebContentProvider`](https://alepha.dev/docs/reference-providers-memorywebcontentprovider) - Web content set by hand, every mode included, for specs.
- [`NativeAppStateProvider`](https://alepha.dev/docs/reference-providers-nativeappstateprovider) - Foreground and background from `@capacitor/app`, which a WebView's own
- [`NativeAuthTransport`](https://alepha.dev/docs/reference-providers-nativeauthtransport) - `ReactAuth`'s transport inside a native shell: password sign-in against
- [`NativeBackButtonProvider`](https://alepha.dev/docs/reference-providers-nativebackbuttonprovider) - The hardware back button from `@capacitor/app` (Android; iOS has none).
- [`NativeDeepLinkProvider`](https://alepha.dev/docs/reference-providers-nativedeeplinkprovider) - Deep links from `@capacitor/app`: the launch URL and `appUrlOpen`.
- [`NativeDeviceProvider`](https://alepha.dev/docs/reference-providers-nativedeviceprovider) - Device information from `@capacitor/device`.
- [`NativeHapticsProvider`](https://alepha.dev/docs/reference-providers-nativehapticsprovider) - Haptics through `@capacitor/haptics`, loaded on first use so a web build
- [`NativeSplashScreenProvider`](https://alepha.dev/docs/reference-providers-nativesplashscreenprovider) - The splash through `@capacitor/splash-screen`, loaded on first use so a web
- [`NativeStatusBarProvider`](https://alepha.dev/docs/reference-providers-nativestatusbarprovider) - The status bar through Capacitor's own `SystemBars`.
- [`NativeTokenStorageProvider`](https://alepha.dev/docs/reference-providers-nativetokenstorageprovider) - Session tokens in the Keychain (iOS) or the Keystore (Android), through
- [`SplashScreenProvider`](https://alepha.dev/docs/reference-providers-splashscreenprovider) - The native launch splash. A no-op on the web, which has none.
- [`StatusBarProvider`](https://alepha.dev/docs/reference-providers-statusbarprovider) - The system bars of a native shell, over `SystemBars` from `@capacitor/core`
- [`TokenStorageProvider`](https://alepha.dev/docs/reference-providers-tokenstorageprovider) - Where a native app keeps its session tokens.
- [`WebContentProvider`](https://alepha.dev/docs/reference-providers-webcontentprovider) - Read-only: where the running web layer came from.
