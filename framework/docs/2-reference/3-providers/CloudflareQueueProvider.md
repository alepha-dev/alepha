# CloudflareQueueProvider

## Import

```typescript
import { CloudflareQueueProvider } from "alepha/queue";
```

## Overview

Cloudflare Queue provider.

Uses a Queue binding for message dispatch. Messages are wrapped with the
logical queue name so the consumer can route them to the correct handler.

**Required Cloudflare binding:**

- `JOBS_QUEUE` - A Queue binding in wrangler configuration
