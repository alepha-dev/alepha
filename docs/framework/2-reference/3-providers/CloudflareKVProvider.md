# CloudflareKVProvider

## Import

```typescript
import { CloudflareKVProvider } from "alepha/cache";
```

## Overview

Cloudflare KV cache provider.

Uses a KV namespace binding for all cache operations.
Keys are stored as: `cache:{name}:{key}`

**Required Cloudflare binding:**

- `KV_CACHE` - A KV namespace binding in wrangler configuration
