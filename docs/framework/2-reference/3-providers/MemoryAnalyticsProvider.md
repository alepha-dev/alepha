# MemoryAnalyticsProvider

## Import

```typescript
import { MemoryAnalyticsProvider } from "alepha/api/analytics";
```

## Overview

An in-memory dataset, and the reference implementation of the seam.

**Required, not a convenience.** `vitest` cannot bind an Analytics Engine
dataset and `wrangler dev` treats its writes as no-ops, so without an
in-process implementation there is no way to exercise the query semantics at
all. Every behaviour the conformance suite pins is defined here first.

Tiering is simulated by rewriting a row's bucket in place, which is exactly
what the relational provider does with two tables - so a boundary-spanning
query can be tested with no database.
