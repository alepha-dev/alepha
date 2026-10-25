# Alepha - Testing Vitest

## Installation

Part of the `alepha` package. Import from `alepha/testing/vitest`.

```bash
npm install alepha
```

## Overview

Vitest helpers.

One shared definition of the jsdom browser-test project, so that every
config declaring one agrees on the environment, the Node flags, the resolve
conditions and the polyfills instead of rediscovering them.

⚠️ Node only, and config-time only. This is imported by a vitest config, not
by app code, and deliberately ships no `index.workerd.ts`.
