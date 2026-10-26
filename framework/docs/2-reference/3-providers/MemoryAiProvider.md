# MemoryAiProvider

## Import

```typescript
import { MemoryAiProvider } from "alepha/ai";
```

## Overview

The in-memory AI provider: the default everywhere, and the one specs drive.

Each `script` call queues one response, played back by the next
`chat` call in order. With nothing queued it answers one text reply
saying no vendor module is registered, so a dev page with a chat renders
and names its own cause instead of failing.

Every request is kept in `requests`, so a spec can assert what the
model would have been sent.
