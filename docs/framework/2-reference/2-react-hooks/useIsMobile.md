# useIsMobile

## Import

```typescript
import { useIsMobile } from "@alepha/ui/hooks/*";
```

## Overview

The shadcn version this started from seeds `undefined` and fills it in from
an effect, which costs an extra render and reads `window.innerWidth` while
subscribing to a media query: two sources that can disagree.
`useSyncExternalStore` reads the same `MediaQueryList` it listens to, and
its server snapshot (`false`) is what React also uses for the hydration
render, so SSR output and the first client render agree by construction.
