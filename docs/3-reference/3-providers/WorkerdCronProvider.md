# WorkerdCronProvider

## Import

```typescript
import { WorkerdCronProvider } from "alepha/scheduler";
```

## Overview

Cloudflare Workers cron provider.

This provider handles scheduled events from Cloudflare Workers Cron Triggers.
Unlike the Node.js CronProvider, this doesn't use intervals/timeouts - instead,
it reacts to scheduled events triggered by Cloudflare.

**Usage:**
1. Define schedulers with `$scheduler({ cron: "0 * * * *", handler: ... })`
2. Build your app with `alepha build` - cron triggers are automatically added to `wrangler.jsonc`
3. Deploy to Cloudflare Workers

**How it works:**
- During build, all registered `$scheduler` cron expressions are collected
- The build generates `wrangler.jsonc` with `triggers.crons` automatically filled
- When Cloudflare fires a cron trigger, the `scheduled` handler emits `cloudflare:scheduled`
- This provider listens to that event and runs matching schedulers

