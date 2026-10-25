# RedisCacheProvider

## Import

```typescript
import { RedisCacheProvider } from "alepha/cache";
```

## Overview

Cache entries in Redis.

Every key is `<alepha.name>:cache:<container>:<key>`, so two apps on one
Redis never read or overwrite each other's entries, and `clear()` deletes
this app's namespace only. Set `APP_NAME` to separate two environments of
one app.
