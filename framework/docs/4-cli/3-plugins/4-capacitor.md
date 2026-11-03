# Capacitor Plugin

`alepha capacitor` makes an iOS and an Android app from an Alepha app: it creates
the native projects, builds the shell, compiles binaries and publishes live
updates. This page is the command reference. What the app does once it runs, and how
to set it up, is in [Native Apps](/docs/guides-deployment-capacitor).

## Quick Start

Declare the app in `alepha.config.ts`. The commands exist once the plugin is
there:

```typescript check filename=alepha.config.ts
import { capacitor } from "@alepha/capacitor/cli";
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  plugins: [
    capacitor({
      appId: "com.example.notes",
      appName: "Notes",
      scheme: "notes",
      apiUrl: "https://api.example.com",
    }),
  ],
});
```

```bash
alepha capacitor init
alepha capacitor dev ios
alepha capacitor build android
```

`alepha capacitor` alone prints the list. `sync`, `build` and `release` need
`apiUrl`, or `PUBLIC_URL`, and refuse without one.

iOS needs macOS and Xcode. Android needs a JDK 21 and the Android SDK. See
[Requirements](/docs/guides-deployment-capacitor#requirements).

## `init`

Creates the native projects from `capacitor({ ... })`.

```bash
alepha capacitor init
alepha capacitor init --platform ios
alepha capacitor init --ota
```

| Flag         | What it does                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--platform` | `ios` or `android`: only this platform, instead of every platform the config declares.                                                                                    |
| `--ota`      | Also wire [live updates](/docs/guides-deployment-capacitor#set-it-up): the updater, the server and device modules, the admin when there is one, and a publisher key pair. |
| `--variant`  | See [Variants](#variants).                                                                                                                                                |

It installs the pinned Capacitor packages, writes `capacitor.config.ts`, runs
`cap add` for each platform, and writes the identity and the icons into the native
projects. A second run writes nothing.

`capacitor.config.ts` is generated: change `capacitor({ ... })`, and `sync`, `build`
or `release` rewrites the file. `ios/` and `android/` are source and are checked in.

## `sync`

Builds the app shell into `dist-capacitor/` and copies it into the native projects.
It never touches `dist/`, so a web deploy is unaffected.

```bash
alepha capacitor sync
alepha capacitor sync --web-only
```

| Flag         | What it does                                                |
| ------------ | ----------------------------------------------------------- |
| `--web-only` | Build the shell only, without touching the native projects. |
| `--variant`  | See [Variants](#variants).                                  |

⚠️ An app already installed on a phone does not change: the shell lives inside the
binary, so rebuild it.

## `build`

Syncs, compiles a native binary, and records it in `capacitor.builds.json`.

```bash
alepha capacitor build android                                       # a debug APK
alepha capacitor build ios                                           # a simulator .app
alepha capacitor build ios --device                                  # a phone, signed with iosTeamId
alepha capacitor build android --release                             # a signed AAB
alepha capacitor build android --release --android-release-type APK  # a signed APK
alepha capacitor build ios --release --export-method release-testing # an IPA
```

The platform is required.

| Flag                     | What it does                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `--release`              | A signed release build through `cap build`, instead of a debug build.                                                         |
| `--device`               | iOS debug: build for a phone instead of the simulator.                                                                        |
| `--export-method`        | iOS release: `debugging` (the default), `release-testing`, `app-store-connect`, `enterprise`, `developer-id` or `validation`. |
| `--android-release-type` | Android release: `AAB` (the default) or `APK`.                                                                                |
| `--variant`              | See [Variants](#variants).                                                                                                    |

An Android release signs with `CAPACITOR_ANDROID_KEYSTORE_PATH`,
`CAPACITOR_ANDROID_KEYSTORE_PASSWORD`, `CAPACITOR_ANDROID_KEY_ALIAS` and
`CAPACITOR_ANDROID_KEY_PASSWORD`.

A build refuses to run on development residue, or on a build number already
recorded from other native inputs. See
[Build a binary](/docs/guides-deployment-capacitor#build-a-binary). Nothing is
uploaded to a store.

## `dev`

Runs the app on a device or a simulator against the Vite dev server, with hot
reload, through `cap run -l`.

```bash
alepha capacitor dev android
alepha capacitor dev ios --target <device-id>
alepha capacitor dev --restore
```

The platform is required, except with `--restore`.

| Flag        | What it does                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--target`  | The device or simulator id, as `cap run --target` takes it. Needed when more than one is available: `dev` refuses and lists them. |
| `--host`    | The address the device reaches this machine on. Defaults to `localhost` for a simulator, the LAN IPv4 for a device.               |
| `--api`     | The API origin the app calls, instead of the configured `apiUrl`.                                                                 |
| `--restore` | Put back the native files an interrupted run changed, then exit.                                                                  |
| `--variant` | See [Variants](#variants).                                                                                                        |

On an iOS phone, or on Android when the app declares a network security config,
`dev` changes a native file for the run and puts it back on exit. A crash leaves
`.capacitor-dev.json` behind, and `sync` and `build` refuse while it exists:
`--restore` puts the files back, and so does the next `dev`.

## `open`

Opens the native project in Xcode or Android Studio.

```bash
alepha capacitor open ios
alepha capacitor open android
```

The platform is required. `--variant` selects the identity the IDE shows.

## `release`

Builds the shell, seals it with `OTA_SIGNING_KEY`, and publishes it as a live update
to the app's own server.

```bash
OTA_SIGNING_KEY=.ota/signing-key.pem OTA_API_KEY=<key> \
  alepha capacitor release android --channel production
```

The platform and `--channel` are required.

| Flag        | What it does                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `--channel` | The channel to publish to, such as `production`.                                                                  |
| `--rollout` | The share of the channel's devices that get it, 0 to 100. Defaults to 10.                                         |
| `--dry-run` | Write the sealed bundle and its manifest under `dist-capacitor/`, and upload nothing. The OTA admin accepts them. |
| `--variant` | See [Variants](#variants).                                                                                        |

| Variable          | What it is                                                                     |
| ----------------- | ------------------------------------------------------------------------------ |
| `OTA_SIGNING_KEY` | The publisher's private key. `--dry-run` needs it too.                         |
| `OTA_API_KEY`     | An API key with `ota:release`, listed on the app. Not needed with `--dry-run`. |

It runs only on the exact native builds recorded with the current native fingerprint,
so a project with no recorded build, or one that changed since, is refused: bump
the build number and build again. See
[Live updates](/docs/guides-deployment-capacitor#live-updates).

⚠️ A live update changes the web layer, never native code. Use it for fixes and
content, and ship features through the stores.

## Variants

`capacitor({ variants })` declares other installable apps from the same code. Once
one exists, every command takes `--variant <name>`, or `--variant base` for the
base app, and refuses without it. Each variant's shell builds into
`dist-capacitor/<variant>/`. Before it works, a command writes that identity into
the native projects, except `release` and `sync --web-only`, which leave them as
they are.
See [Variants](/docs/guides-deployment-capacitor#variants).

## One command at a time

Commands rewrite the native projects, so one runs at a time per project, `dev
--restore` aside. The lock is a `.capacitor-lock` directory, removed when the command
ends. A command that was
killed leaves it behind: if none is running, delete the directory.
