# DateTime

## Import

```typescript
import { DateTime } from "alepha/datetime";
```

## Overview

Immutable wrapper around the underlying date-time engine.

Designed to isolate consumers from the engine in use (currently dayjs).
Methods that produce a new value return a new `DateTime` instance.

