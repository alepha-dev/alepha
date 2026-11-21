# LockProvider

## Import

```typescript
import { LockProvider } from "alepha/lock";
```

## Overview

The contract a lock backend implements.

A backend stores string values by key: `set` (optionally only if the key is
absent, optionally with an expiry), `get`, `del` and `delIfOwner`. `$lock`
takes a lock with `set(key, value, true, maxDuration)` and releases it with
`delIfOwner`; `del` itself is unconditional.
