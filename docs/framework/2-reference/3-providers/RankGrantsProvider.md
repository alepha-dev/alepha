# RankGrantsProvider

## Import

```typescript
import { RankGrantsProvider } from "alepha/api/ranks";
```

## Overview

The implementation of `alepha/security`'s grants seam, filled by this
module.

`$owns({ requires })` calls this with the rows it already read, and this
turns them into an allow or a deny. Registering the module is what
substitutes it; an application that never does keeps the permissive default
and behaves exactly as it did before `requires` existed.

⚠️ **It issues no query for the assignment**, and cannot: the request
carries rows, never ids. The only read is the scope's rank definitions, and
that one is cached and skipped entirely for a scope nobody has customised.
