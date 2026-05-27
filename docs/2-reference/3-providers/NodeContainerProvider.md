# NodeContainerProvider

## Import

```typescript
import { NodeContainerProvider } from "alepha/container";
```

## Overview

Node (dev / test / non-Cloudflare) container provider.

Routes proxy calls through plain `fetch()` against the URL given on
the `$container` primitive. If no `url` is supplied, calls throw —
v1 deliberately has no Docker spawning. This is the "temporary, not
perfect" Node path documented in the spec; the longer-term plan is
to plug in a `target=docker` adapter once that lands.

