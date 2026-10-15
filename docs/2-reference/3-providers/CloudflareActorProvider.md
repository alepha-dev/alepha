# CloudflareActorProvider

## Import

```typescript
import { CloudflareActorProvider } from "alepha/actor";
```

## Overview

Routes independent encoded actor identities to the shared native host.
A missing ALEPHA_ACTOR binding is an error, never a Memory fallback.
A refused call rethrows an `AlephaError` carrying the host error's message
and name; its class does not cross the Durable Object boundary.
