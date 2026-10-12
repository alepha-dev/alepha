# RedisLockProvider

## Import

```typescript
import { RedisLockProvider } from "alepha/lock/redis";
```

## Overview

Locks over Redis `SET NX PX`.

Every key is `<alepha.name>:lock:<key>`, here rather than in `$lock`, so a
caller of `LockProvider` that bypasses the primitive (the job cron
claims) is namespaced too. Two apps on one Redis never contend for each
other's locks; set `APP_NAME` to separate two environments of one app.
