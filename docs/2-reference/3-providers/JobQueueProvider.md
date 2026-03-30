# JobQueueProvider

## Import

```typescript
import { JobQueueProvider } from "alepha/api/jobs";
```

## Overview

Optional queue-backed dispatch for the job system.

When registered, `JobProvider` will push work through this queue instead of
executing inline. This is the default for long-running (non-serverless) environments.
In serverless environments (Cloudflare Workers, Vercel), this provider is typically
omitted so jobs execute inline without requiring an external queue resource.

