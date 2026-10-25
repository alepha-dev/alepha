# RedisTopicProvider

## Import

```typescript
import { RedisTopicProvider } from "alepha/topic";
```

## Overview

Topics over Redis pub/sub.

Every channel and retained key is `<alepha.name>:topic:<name>`, so two apps
(or two environments of one app) on the same Redis never receive each
other's messages, the framework's own `websocket:broadcast`,
`parameter:sync` and `lock:end` included. Set `APP_NAME` to separate them.
