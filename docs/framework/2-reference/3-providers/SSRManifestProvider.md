# SSRManifestProvider

## Import

```typescript
import { SSRManifestProvider } from "alepha/react/router";
```

## Overview

Provider for SSR manifest data used for module preloading.

Every answer here was resolved by the build and embedded into the generated
index.js, so this is a table lookup rather than a graph walk. It used to be
the latter: the whole Vite client manifest travelled inside the server
bundle, and each request walked 80 to 118 chunks of it to rebuild a fragment
that cannot vary by request.
