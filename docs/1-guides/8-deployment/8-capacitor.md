# Native Apps (iOS and Android)

`@alepha/capacitor` turns an Alepha app into an iOS and an Android app. The same `$page` router,
React components and DI services run inside a [Capacitor](https://capacitorjs.com) WebView, bundled
into the binary, and call an ordinary Alepha backend over HTTPS. Native capabilities (secure
storage, haptics, deep links, the status bar, the back button) sit behind providers, so app code
never imports `@capacitor/*`.

There is no native navigation plugin: tabs, stacks and transitions are the router's, in the DOM,
with the platform's chrome around them.

## Requirements

- **iOS**: macOS with Xcode, and the iOS platform its SDK names (Xcode > Settings > Components). The
  iOS project uses the Swift Package Manager, Capacitor 8's default; CocoaPods projects are refused.
- **Android**: a JDK 21 (Android Studio's `Contents/jbr/Contents/Home` works as `JAVA_HOME`) and the
  Android SDK (`ANDROID_HOME`).
- Capacitor 8.5, pinned by the package. A free Apple account is enough to run on your own iPhone
  (the signature lasts 7 days); nothing here needs a paid account or submits to a store.

Proven so far on an iOS 26.5 simulator, an Android 16 emulator and a Pixel 7a on Android 17; not
yet on a physical iPhone.

## Declare the app

```ts
// alepha.config.ts
import { capacitor } from "@alepha/capacitor/cli";
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  plugins: [
    capacitor({
      appId: "com.example.notes",
      appName: "Notes",
      scheme: "notes",
      apiUrl: process.env.NOTES_API_URL,
      icon: { source: "assets/icon.svg", background: "#FFFFFF" },
    }),
  ],
});
```

| Key         | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `appId`     | Bundle identifier (iOS) and application id (Android), reverse-DNS                                    |
| `appName`   | The name under the icon                                                                              |
| `scheme`    | The custom URL scheme of deep links, without `://`                                                   |
| `apiUrl`    | The origin of the API the app calls. Falls back to `PUBLIC_URL`; a path or query is refused          |
| `icon`      | A square PNG of at least 1024 px, or an SVG, and the colour behind it                                |
| `iosTeamId` | The Apple team that signs device builds                                                              |
| `env`       | Values the browser code may read. They ship inside the app: names that look like secrets are refused |
| `platforms` | The native projects the app has, both by default                                                     |
| `config`    | Extra `capacitor.config.ts` settings, typically plugin options. It cannot set `server.url`           |
| `variants`  | Other installable apps from the same code, see [Variants](#variants)                                 |

Register the native module in the browser entry, before the module that imports `AlephaReactAuth`:

```ts
// src/main.browser.ts
import { AlephaCapacitor } from "@alepha/capacitor";
import { Alepha, run } from "alepha";

import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(AlephaCapacitor);
alepha.with(WebModule);

run(alepha);
```

In a plain browser `AlephaCapacitor` binds web fallbacks and changes nothing, so the same entry
serves the website.

## Create the native projects

```bash
yarn alepha capacitor init
```

`init` installs the pinned Capacitor packages, writes `capacitor.config.ts` (generated, do not edit
it: change `capacitor({ ... })`), runs `cap add` for each platform, and writes the app's identity
into the native projects: bundle id, display name, the URL scheme, and the icons and splash
generated from `icon`. It is idempotent: a second run writes nothing. `--platform ios` limits it to
one platform.

`ios/` and `android/` are source and are checked in. Their build outputs, `dist-capacitor/` and
signing keys are ignored.

## The app shell

```bash
yarn alepha capacitor sync
```

`sync` builds a lean static shell into `dist-capacitor/` (never `dist/`, so a web deploy is
untouched) and copies it into the native projects; `--web-only` stops after the shell. The shell
renders no page on the server: it is the app's document with an empty root, `viewport-fit=cover`,
and the public configuration baked in as a Vite `define`: `appId`, `variant`, `scheme`, `mode`,
`apiUrl` and `env`, nothing else.

Syncing does not change an app already installed on a phone: the shell lives inside the binary, so
rebuild it.

### Calling the API

Every host-less `$client` and `useClient()` call goes to `apiUrl`: the WebView's own origin
(`capacitor://localhost` on iOS, `https://localhost` on Android) serves the shell and nothing else.
Calls take the remote path and are not batched.

The API must admit those two origins. `CAPACITOR_ORIGINS` from `alepha/server/cors` names them, with
credentials off:

```ts check
import { $hook, $inject, Alepha } from "alepha";
import { CAPACITOR_ORIGINS, corsOptions } from "alepha/server/cors";

export class CorsPolicy {
  protected readonly alepha = $inject(Alepha);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      this.alepha.store.mut(corsOptions, (options) => ({
        ...options,
        origin: CAPACITOR_ORIGINS,
        credentials: false,
      }));
    },
  });
}
```

`origin` is a comma-separated list: append the dev server's origin while developing on a phone,
since a development run loads the app from it.

### Sign-in

Inside the native shell, `ReactAuth` signs in with a password against `apiUrl` and keeps the session
in the platform's secure storage (Keychain, Android Keystore), sending it as a `Bearer` token with
`credentials: "omit"`: a cookie of the API's origin would never reach the WebView. Only host-less
calls to `apiUrl` carry the token. MFA completes through the same transport.

- Concurrent requests that need a fresh token share one refresh.
- A refused refresh clears the session; a refresh that gets no response keeps it, so a phone offline
  for a day is still signed in.
- Signing out revokes the session on the server, so its refresh token is refused from then on. An
  access token already issued stays valid until it expires (15 minutes by default), as on the web.
- Sign-in through a browser redirect (Google, Apple) is not supported yet.

### Boot and the offline screen

A phone often starts without a network. In the shell the router's first transition is bounded: when
the API gives no HTTP response, or nothing at all within 5000 ms, the app commits an offline screen
with a retry instead of a blank WebView. An HTTP error, a 500 included, is an error, not offline.
Retry runs the boot again, the session restore included, and lands on the normal, authenticated
flow once the API answers. A deep link that arrives while the offline screen is up does the same
for its own page. Nothing is cached and no write is queued.

The splash hides as soon as the first screen settles, healthy (a page, or the offline screen) or
failed; it never hides on a timer. As a backstop for a WebView whose JavaScript never got that far,
the generated config sets `launchAutoHide` after 8000 ms (the deadline plus 3000); an app that
raises `reactBootOptions.deadline` raises `plugins.SplashScreen.launchShowDuration` in `config` too.
When the app fails to start on a blank page, a plain message with a reload button is written into
the page.

## Native chrome

Inside the shell `<html>` carries `data-native="ios"` or `"android"`. The `@alepha/ui` stylesheet
scopes its native policy to it: no tap highlight, no rubber band past the page, no long-press
preview of links and images. Selection is never disabled, and fields and editable text keep their
callout. Identifier fields (`email`, `url`, `username`, `tel`, one-time codes) turn off
auto-capitalisation, autocorrect and spellcheck.

**Safe areas.** The shell is edge to edge. Pad what must clear the notch, the status bar and the
home indicator with the opt-in utilities `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe` and `px-safe`,
on an element of its own:

```tsx
<header className="pt-safe border-b">
  <div className="flex items-center gap-4 px-4 py-3">...</div>
</header>
```

They resolve to `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`: Capacitor's
`SystemBars` injects the variables on Android, because WebViews older than 140 misreport `env()`,
and iOS uses `env()`. Both are 0 in a browser, so the same markup serves the website.

**Status bar.** It follows the theme: `class="dark"` on `<html>` (what `ColorScheme` from
`alepha/react/ui` toggles) asks for light content.

**Back button.** Android's back button runs a chain: handlers registered on `BackButtonProvider`,
the last registered first, until one returns `true`; then the router's history when `canGoBack`;
then it exits the app. A cold start or a deep link is the root entry, so back from it exits. Close
an open overlay first with a handler:

```ts
import { BackButtonProvider } from "@alepha/capacitor";
import { $hook, $inject } from "alepha";

export class OverlayBackHandler {
  protected readonly back = $inject(BackButtonProvider);
  protected unregister?: () => void;

  protected readonly onReady = $hook({
    on: "ready",
    handler: () => {
      this.unregister = this.back.register(() => {
        const open = document.querySelector('[role="dialog"][data-open]');
        if (!open) return false;
        (document.activeElement ?? open).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        return true;
      });
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => this.unregister?.(),
  });
}
```

**Haptics, device, app state.** `HapticsProvider` (`impact`, `notification`, `selection`),
`DeviceProvider` (`info`), `AppStateProvider` (the `capacitor:app:state` event) and
`StatusBarProvider` are injectable anywhere; each is a no-op or a web fallback in a browser.

## Deep links

`notes://app/notes/42` opens `/notes/42`: the path after `app/` is a route, with its query and hash.
A link that launches the app becomes its first screen; one opened while it runs is pushed onto the
router; the same link reported twice is handled once; another app's scheme is ignored, and so is a
path with a `..` segment. `notes://auth/...` is reserved for a future browser sign-in. Universal
links and app links are not supported yet.

## Develop on a device

```bash
yarn alepha capacitor dev android
yarn alepha capacitor dev ios --target <device-id>
```

`dev` serves the app from the Vite dev server with hot reload, inside the native shell, through
`cap run -l`. It picks the target (`--target`, or the only one there is) and the address the device
reaches this machine on: `localhost` for a simulator or an emulator (Android gets an `adb reverse`,
kept alive while the run lasts), the single LAN IPv4 for a phone. With several plausible addresses
(a VPN, a second network) it refuses with the list; `--host` settles it. `--api` names the API
instead of `apiUrl`; with neither, the dev server is the API.

Loading plain HTTP from the dev server needs development exceptions that a release must never
carry, and `dev` sets them for the run:

- on an iOS phone, `NSAllowsLocalNetworking` in `Info.plist`;
- on Android, when the app declares a network security config, a `domain-config` allowing cleartext
  to the dev host alone. Android ignores the manifest's `usesCleartextTraffic`, which `cap run -l`
  sets, once such a config exists.

`dev` records the originals in `.capacitor-dev.json` and puts them back on exit, on Ctrl+C and when
the launch fails. A crash cannot restore anything: the next `sync` or `build` refuses while the
journal exists, and `alepha capacitor dev --restore` puts the files back. A build also refuses any
of those exceptions it finds, so nothing a dev run changes can reach a binary.

In dev the page is server-rendered, and the server never sees the native session: a signed-in app
logs a hydration mismatch on its account menu, which React repairs. A bundled build has no server
render.

## Build a binary

```bash
yarn alepha capacitor build android            # a debug APK
yarn alepha capacitor build ios                # a simulator .app
yarn alepha capacitor build ios --device       # a phone, signed with iosTeamId
yarn alepha capacitor build android --release  # a signed AAB (--android-release-type APK)
yarn alepha capacitor build ios --release      # an IPA, exported for debugging
yarn alepha capacitor open ios                 # Xcode
```

`build` always syncs first, then compiles. A debug build installs without any store. A release
build goes through `cap build` with explicit signing: on Android a keystore named by
`CAPACITOR_ANDROID_KEYSTORE_PATH`, `CAPACITOR_ANDROID_KEYSTORE_PASSWORD`,
`CAPACITOR_ANDROID_KEY_ALIAS` and `CAPACITOR_ANDROID_KEY_PASSWORD` (passed as arguments, never
through a shell, masked in logs); on iOS an IPA exported with `--export-method`, `debugging` by
default, never a store export unless asked. Nothing is uploaded to a store.

Every successful build appends a record to `capacitor.builds.json` (checked in): app id, platform,
variant, the build number read from the native project (`CURRENT_PROJECT_VERSION`,
`versionCode`), a fingerprint of the native inputs, the signing and the artifact's digest. A build
number already recorded from other native inputs is refused before anything compiles: bump it.

Before syncing, a build also refuses development residue: a `server.url`, App Transport Security
exceptions in `Info.plist`, and cleartext or user certificate authorities outside the
`debug-overrides` of the Android network security config.

## Variants

One codebase can ship several installable apps, a generic one and branded builds:

```ts
capacitor({
  appId: "com.example.notes",
  appName: "Notes",
  scheme: "notes",
  icon: { source: "assets/icon.svg" },
  variants: {
    acme: {
      appId: "com.example.notes.acme",
      appName: "Acme Notes",
      scheme: "acmenotes",
      apiUrl: "https://notes.acme.example",
      icon: { source: "assets/acme.svg", background: "#0F172A" },
    },
  },
});
```

A variant overrides identity keys of the base: `appId`, `appName`, `scheme`, `apiUrl`, `icon`,
`iosTeamId`, `env`. App ids and schemes must be unique, and a variant icon needs a base icon.

Once a variant exists, every command names the one it works on, the base included, and refuses
without it:

```bash
yarn alepha capacitor build android --variant acme
yarn alepha capacitor build android --variant base
```

There is one pair of native projects. Each command first writes the selected identity into it: the
bundle id, the display name, the URL scheme, `applicationId` and the identity strings, the icons and
splash. The writer owns those settings only, refuses a project it does not recognise (a second
target, URL types of your own, product flavors) before writing anything, and puts every file back
when a switch fails. Switching x, then y, then x leaves the files byte for byte as they were. Each
variant's shell builds into `dist-capacitor/<variant>/`, and its build records carry its name. One
command runs at a time per project.

## HTTPS for a phone

A bundled app calls its API over HTTPS: its own origin is secure, so Android blocks a plain `http://`
API as mixed content and iOS App Transport Security refuses it. To test against a backend on your
machine:

1. Make a certificate with [mkcert](https://github.com/FiloSottile/mkcert) naming the machine's LAN
   address (and `localhost` for simulators and `adb reverse`).
2. Serve the app's workerd build with `wrangler dev --local-protocol https` and that certificate.
   The Alepha server itself has no TLS listener.
3. Trust mkcert's root on each device: `mkcert -CAROOT` prints the folder holding `rootCA.pem`.
   - **iOS phone:** install `rootCA.pem` as a profile (Settings > General > VPN & Device
     Management), then turn on full trust (Settings > General > About > Certificate Trust
     Settings).
   - **iOS simulator:** `xcrun simctl keychain <udid> add-root-cert "$(mkcert -CAROOT)/rootCA.pem"`.
   - **Android:** copy `rootCA.pem` to the device and install it in Settings > Security >
     Encryption & credentials > Install a certificate > **CA certificate**. Apps ignore user CAs
     unless their network security config trusts them; trust them in `debug-overrides` only, so a
     debug build honours the root and a release never does.

No cleartext exception is involved, so the network rules under test are the release ones.

## Live updates

A shipped binary can take a new web layer (the HTML, JavaScript, CSS and assets it runs) from the
app's own server, without a store release. Native code never changes this way: a new plugin, a
native setting or a new build number still goes through a build and a store.

Three entries carry it, on top of `@alepha/capacitor`:

| Entry                         | Where it runs                       | What it does                                                   |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `@alepha/capacitor/ota`       | the browser entry, inside the shell | asks the server, downloads, applies, acknowledges              |
| `@alepha/capacitor/ota-api`   | the server                          | stores bundles, picks each device's bundle, signs its download |
| `@alepha/capacitor/ota-admin` | the admin, beside `AdminRouter`     | channels, rollout, kill switch, rollback, device overrides     |

The device side is [`@capgo/capacitor-updater`](https://capgo.app/docs/plugin/) 8.52.1, pinned, in
manual mode and pointed at your server: no Capgo account and no hosted service are involved.

### Set it up

```bash
yarn alepha capacitor init --ota
```

On top of `init`, it:

- adds `ota: { publicKey: "ota-public.pem" }` to `capacitor({ ... })`;
- registers `AlephaCapacitorOtaApi` in `src/main.server.ts`, and `AlephaCapacitor` then
  `AlephaCapacitorOta` in `src/main.browser.ts`;
- adds `OtaAdminRouter` beside `AdminRouter` when the app has an admin, and nothing otherwise;
- installs the updater and links it into the native projects;
- mints the publisher's key pair: `ota-public.pem`, committed, and `.ota/signing-key.pem`, mode
  0600 and gitignored;
- adds `OTA_DOWNLOAD_SECRET=` to `.env.example`.

Every edit is planned first: a file it does not recognise (an entry that does not build its
container the scaffold's way, a config without one `capacitor({ ... })` call) refuses the whole run
with the change to make by hand, and nothing is written. A second run changes nothing, and keys are
never minted again over an existing private key.

Then, once, in the admin's **Live updates** page: register the app with the content of
`ota-public.pem`, create an API key with the `ota:release` permission, and list that key on the
app. Nothing grants OTA permissions on its own: `ota:read`, `ota:manage` and `ota:release` go to
the roles that need them.

### Who holds which key

| Secret                 | Held by                                                             | Never in                 |
| ---------------------- | ------------------------------------------------------------------- | ------------------------ |
| `.ota/signing-key.pem` | whoever publishes, as `OTA_SIGNING_KEY` (a CI secret)               | the app, the server, git |
| `OTA_API_KEY`          | whoever publishes: an API key with `ota:release`, listed on the app | the app, the server      |
| `OTA_DOWNLOAD_SECRET`  | the server, set in every environment                                | the app, the publisher   |
| `ota-public.pem`       | everyone: it ships in the native config                             | (public)                 |

Bundles use Capgo's v2 encryption: the archive is encrypted with a fresh AES key, and that key and
the archive's checksum are encrypted with the publisher's private key. A device opens them with the
public key in its native config and refuses a bundle sealed with another key, altered, or carrying
another bundle's checksum. The server opens each upload with the same public key before accepting
it, so a bundle the devices would refuse never reaches them.

### Publish

```bash
OTA_SIGNING_KEY=.ota/signing-key.pem OTA_API_KEY=<key> \
  yarn alepha capacitor release android --channel production
```

`release` builds the shell, seals it and uploads it to `ota-api` on the app's `apiUrl` (or
`capacitor({ ota: { url } })`). `--rollout` sets the share of devices that take it, 10 percent by
default; `--variant` names the variant once there are any. An upload that fails on the network or
with a 5xx is retried with the same release id, so a retry never publishes twice.

`--dry-run` stops before uploading and leaves the release in
`dist-capacitor/ota/<version>-<platform>/`: `bundle.zip`, the encrypted archive, and
`manifest.json`, which describes it. The admin's upload takes those two files, so a release sealed
on one machine can be published from the browser. The browser never sees the private key: it only
uploads what was sealed already.

A release refuses, before sealing anything:

- a native project with no recorded build (`capacitor.builds.json`), or one that changed since its
  recorded builds: no shipped binary could run that web layer, so bump the build number and build
  again;
- development residue that would ship, such as a `server.url`;
- a signing key that is not the private half of `ota-public.pem`;
- a symlink in the shell.

### Which bundle a device gets

A bundle carries the exact native build numbers it was sealed for and a fingerprint of the native
project, never a minimum version. A device whose build no bundle lists is told it is blocked, and
keeps what it runs.

Each channel (`production` to begin with) holds one cohort per platform and native fingerprint:
an `active` bundle, the share of devices that take it, and a `fallback` for the others. A device's
place in the rollout is a stable hash of the app, the channel and the device, so raising the
rollout only adds devices. From the admin:

- **Rollout**: change the share of a cohort's devices that take `active`.
- **Promote** an older bundle, or **roll back** to one: it becomes `active` again.
- **Kill** a bundle: no device is sent it any more, and devices fall back to the cohort's
  `fallback`. With no usable fallback, a device running the killed bundle returns to the web layer
  built into its binary.
- **Device overrides** pin one device to a bundle or a channel, for support or a tester.

A device may move itself to a channel marked self-assignable (`OtaProvider.setChannel("beta")`);
every other channel is an operator's choice. Download links are signed with
`OTA_DOWNLOAD_SECRET` and expire after ten minutes. The newest 10 bundles of each cohort are kept,
along with every bundle a cohort, an override or a live link still names.

### On the device

`AlephaCapacitorOta` is inert in a browser, in a `dev` shell, and in a shell built without
`capacitor({ ota })`, and says why in the log.

- **Checks** run at boot, on every return to the foreground, and every ten minutes while the app
  stays in front, one at a time. A failed check backs off.
- **A new bundle downloads in the background and applies on the next background or restart**, never
  as a reload in front of the user.
- **Acknowledgment.** A bundle counts as healthy once its first screen settles healthy, and the
  device then tells the updater so. A first screen that fails is never acknowledged, and the
  updater puts the previous web layer back by itself: the readiness timeout is 10 seconds, and on
  Android the rollback came about 30 seconds after the switch in testing. A bundle the device
  rolled back from is never downloaded again on that device.
- **Offline is healthy.** The local "server cannot be reached" or "taking too long" screen counts
  as a healthy first screen: an unreachable or stalled API never rolls a good bundle back, and the
  session is kept. Retry takes the app back to its routes once the API answers.
- **The kill switch reaches a device at its next contact.** A killed bundle that is downloaded and
  waiting is withdrawn by the next check; one already running gives way on the next background
  after a check. A device that stays offline keeps what it has.

### Apple and Google

Live updates change interpreted code only, which is what both stores allow; Apple's guideline 2.5.2
draws the line (see [App Store and Play Store](#app-store-and-play-store)). Ship fixes and content
this way, and features through the stores.

## App Store and Play Store

This package builds and signs binaries; it does not submit them, and nothing it does guarantees
approval. Read the [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
before submitting: 4.2 (minimum functionality) is about the experience the app gives, not about how
its views are built, and 4.8 asks an app offering third-party sign-in to also offer an equivalent
privacy-preserving option, with listed exceptions. A password sign-in alone is not third-party
sign-in. Sign in with Apple is the recommended way to add social login later. The
[`cap build` reference](https://capacitorjs.com/docs/cli/commands/build) covers the signing options
the release builds use.

Live updates (`alepha capacitor release`) replace the web layer only, the HTML, JavaScript, CSS and
assets the binary already runs, never its native code. Guideline 2.5.2 allows interpreted code
that does not change the app's primary purpose, features or functionality, nor add a store or
bypass review: use them for fixes and content, and ship features through the stores. That is the
intended use, not a promise of approval.

## Not yet

Push notifications, sign-in through a browser redirect, universal links and app links are future
work, and so are delta live updates and a hosted update service.
