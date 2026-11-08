# MemoryTraceProvider

## Import

```typescript
import { MemoryTraceProvider } from "alepha/tracing";
```

## Overview

Keeps finished spans in memory, grouped by trace, for devtools and specs.

A bounded ring: the last `maxTraces` traces (200), each capped at
`maxSpansPerTrace` spans (1000), the oldest trace dropped first.
Never unbounded. Registering it (injecting it) turns recording on and
forces sampling to 1.

```ts
const alepha = Alepha.create();
const traces = alepha.inject(MemoryTraceProvider);
await alepha.start();
// ... exercise the app
expect(traces.spans().map((s) => s.name)).toContain("GET /users");
```
