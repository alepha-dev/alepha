# ServerCsrfProvider

## Import

```typescript
import { ServerCsrfProvider } from "alepha/security";
```

## Overview

CSRF protection via Origin header validation.

On every state-changing request (POST, PUT, PATCH, DELETE), validates that the
`Origin` header (or `Referer` fallback) matches the server's own origin.

Requests without an `Origin` or `Referer` header are allowed through,
as SameSite cookies already prevent cross-site requests in that scenario.

