# MemoryWindowProvider

## Import

```typescript
import { MemoryWindowProvider } from "@alepha/desktop/shell";
```

## Overview

A window that only records what was asked of it.

`run` resolves when the spec calls `close` (the user closing the
window or pressing Cmd+Q) or `terminate` (the supervisor unblocking
the loop), so a spec plays the native loop by hand.
