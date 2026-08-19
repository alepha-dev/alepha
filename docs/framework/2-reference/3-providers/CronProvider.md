# CronProvider

## Import

```typescript
import { CronProvider } from "alepha/scheduler";
```

## Overview

The single registry of cron expressions in the container.

`$job({ cron })` registers here; the Cloudflare build reads the registry to
emit native platform triggers. `createCronJob(name, expression, handler)`
registers a raw tick directly - no distributed lock, no run history, no
retries: on multiple replicas every replica fires. Use `$job({ cron })`
unless a database is genuinely unavailable.

