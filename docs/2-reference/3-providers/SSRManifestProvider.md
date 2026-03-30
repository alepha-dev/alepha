# SSRManifestProvider

## Import

```typescript
import { SSRManifestProvider } from "alepha/react/router";
```

## Overview

Provider for SSR manifest data used for module preloading.

The manifest is populated at build time by embedding data into the
generated index.js via the ssrManifestAtom. This eliminates filesystem
reads at runtime, making it optimal for serverless deployments.

Manifest files are generated during `vite build`:
- manifest.json (client manifest)
- preload-manifest.json (from viteAlephaSsrPreload plugin)

