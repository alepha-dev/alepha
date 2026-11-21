# MemoryTopicProvider

## Import

```typescript
import { MemoryTopicProvider } from "alepha/topic";
```

## Overview

Topics in memory, inside one container.

The provider of an app with no `REDIS_URL`, and of tests: a message
reaches the subscribers of this instance only. A parameterized topic
matches one level per placeholder.
