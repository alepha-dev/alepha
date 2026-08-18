# DateTimeProvider

## Import

```typescript
import { DateTimeProvider } from "alepha/datetime";
```

## Overview

The injectable clock. Every service reads time through it — `nowMillis()`,
`now()`, `nowISOString()` — instead of `Date.now()`, which is what makes
time testable: `pause()` freezes the clock and `travel()` moves it, also
releasing `CronProvider` waits so scheduled work can be exercised in tests.

