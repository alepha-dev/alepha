# useIsMobile

## Import

```typescript
import { useIsMobile } from "@alepha/ui/hooks/*";
```

## Overview

Upstream's version seeds `undefined` and fills it in from an effect, which
costs an extra render and reads `window.innerWidth` while subscribing to a
media query: two sources that can disagree. `useSyncExternalStore` reads
the same `MediaQueryList` it listens to, and its server snapshot (`false`)
is what React also uses for the hydration render, so SSR output and the
first client render agree by construction.

Re-applied after `yarn w @alepha/ui sync`, which overwrites `src/hooks/`.
