# UpdaterAdapter

## Import

```typescript
import { UpdaterAdapter } from "@alepha/capacitor/ota";
```

## Overview

The live updater's native surface, as `OtaProvider` uses it: the subset
of the pinned `@capgo/capacitor-updater` 8.52.1 a manual, self-hosted
policy needs, behind a class a spec substitutes.

This base is "no updater": inert in a browser, a test or a shell built
without the plugin. `CapgoUpdaterAdapter` is the native one,
`MemoryUpdaterAdapter` the spec's.
