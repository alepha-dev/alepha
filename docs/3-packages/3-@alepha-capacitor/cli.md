# @alepha/capacitor - Cli

## Installation

```bash
npm install @alepha/capacitor
```

## Overview

The `alepha capacitor` commands: native iOS and Android projects for an
Alepha app, and the app shell they run.

Declared in `alepha.config.ts`, which the `alepha` CLI loads:

```ts
import { capacitor } from "@alepha/capacitor/cli";
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  plugins: [
    capacitor({
      appId: "dev.alepha.mobile",
      appName: "Mobile",
      scheme: "mobile",
      apiUrl: "https://api.example.com",
    }),
  ],
});
```

Then:

- `alepha capacitor init` creates `ios/` and `android/` (both checked in),
  installs the pinned Capacitor packages and writes `capacitor.config.ts`;
- `alepha capacitor sync` builds the app shell into `dist-capacitor/` and
  copies it into the native projects;
- `alepha capacitor build ios|android` syncs, compiles a binary and records
  it in `capacitor.builds.json`;
- `alepha capacitor dev ios|android` runs the app against the Vite dev
  server over the LAN, with hot reload;
- `alepha capacitor open ios|android` opens Xcode or Android Studio;
- `alepha capacitor release ios|android --channel <name>` publishes the
  web layer as a live update (`CapacitorRelease`).

### Live updates

`alepha capacitor init --ota` (`CapacitorOtaSetup`) wires them into
an existing app: `@capgo/capacitor-updater`, `ota-api` on the server, the
device client in the browser entry, the OTA admin when the app has one,
and a publisher key pair. Three kinds of configuration, three places:

- **public, in the app**: the app identity, `apiUrl`, and
  `capacitor({ ota: { publicKey } })` (`ota-public.pem`, committed), which
  the native config carries and every device reads;
- **publisher secrets, on the machine or CI that releases**:
  `OTA_SIGNING_KEY` (the private key, `.ota/signing-key.pem`, gitignored)
  and `OTA_API_KEY` (an API key with the `ota:release` scope, listed on the
  app in the OTA admin). Never in the app, the server or a deployment;
- **server runtime**: `OTA_DOWNLOAD_SECRET`, which signs download links,
  and the app's public key stored when it is registered.

Then, from a saas app (`alepha init --preset saas`) with
`capacitor({ appId, appName, scheme })` in its config:

```bash
alepha capacitor init --ota          # native projects, updater, wiring, keys
alepha capacitor dev ios             # LAN dev with HMR (no live updates in dev)
alepha capacitor build ios           # a bundled binary, recorded with its fingerprint
alepha dev                           # the local backend; register the app in /admin/ota
OTA_SIGNING_KEY=.ota/signing-key.pem alepha capacitor release ios --channel production --dry-run
OTA_SIGNING_KEY=.ota/signing-key.pem OTA_API_KEY=ak_... alepha capacitor release ios --channel production
```

iOS needs macOS and Xcode. A phone reaches a local backend over HTTPS it
trusts (an mkcert root installed on the device; Android trusts user roots
in `debug-overrides` only); production is HTTPS. A bundled build never has
`server.url`. Policy: a release runs only on the exact native builds
recorded with the current native fingerprint, rolls out to 10 percent by
default, applies on the next background or restart, and is acknowledged
once the first screen (the offline screen included) commits; the kill
switch and rollbacks reach a device at its next check.

`variants: { acme: { appId, appName, scheme, apiUrl, icon } }` declares
other installable apps from the same code. Every command then takes
`--variant <name>` (or `--variant base`), refuses without it, and first
writes that identity into the one pair of native projects
(`NativeIdentity`); each variant's shell builds into
`dist-capacitor/<variant>/`. One command runs at a time per project
(`CapacitorLock`).

Node only: this entry reaches the file system, the shell and the build
pipeline. Browser code imports `@alepha/capacitor` (the `core` entry).
