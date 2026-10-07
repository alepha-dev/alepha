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
- `alepha capacitor open ios|android` opens Xcode or Android Studio.

`variants: { acme: { appId, appName, scheme, apiUrl, icon } }` declares
other installable apps from the same code. Every command then takes
`--variant <name>` (or `--variant base`), refuses without it, and first
writes that identity into the one pair of native projects
(`NativeIdentity`); each variant's shell builds into
`dist-capacitor/<variant>/`. One command runs at a time per project
(`CapacitorLock`).

Node only: this entry reaches the file system, the shell and the build
pipeline. Browser code imports `@alepha/capacitor` (the `core` entry).
