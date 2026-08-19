# LogBufferProvider

## Import

```typescript
import { LogBufferProvider } from "alepha/logger";
```

## Overview

Access to the log buffer of the current execution context.

An entry point (the HTTP router, the job runner) seeds a buffer into the
context it already opens; every log emitted inside that context is then
captured, **including entries suppressed by the active `LOG_LEVEL`** - those
are precisely the breadcrumbs worth having when something fails in
production.

