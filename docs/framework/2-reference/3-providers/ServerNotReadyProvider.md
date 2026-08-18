# ServerNotReadyProvider

## Import

```typescript
import { ServerNotReadyProvider } from "alepha/server";
```

## Overview

On every request, this provider checks if the server is ready.

If the server is not ready, it responds with a 503 status code and a message indicating that the server is not ready yet.

The response also includes a `Retry-After` header indicating that the client should retry after 5 seconds.

