# CapgoUpdaterAdapter

## Import

```typescript
import { CapgoUpdaterAdapter } from "@alepha/capacitor/ota";
```

## Overview

The pinned `@capgo/capacitor-updater` 8.52.1, on a native shell whose
config sets `autoUpdate: false`, the three `/ota` URLs, `publicKey` and
`allowManualBundleError: true`.

The plugin is loaded on first use, so a shell that never reaches the
updater never runs its module.
