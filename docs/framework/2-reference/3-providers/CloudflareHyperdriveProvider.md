# CloudflareHyperdriveProvider

## Import

```typescript
import { CloudflareHyperdriveProvider } from "alepha/orm/postgres";
```

## Overview

Cloudflare Hyperdrive PostgreSQL provider using Drizzle ORM.

Connects to an external PostgreSQL database through Cloudflare Hyperdrive,
which provides connection pooling and caching at the edge.

Creates a fresh connection per request, since Cloudflare Workers
cannot reuse I/O objects across request contexts.

URL format: hyperdrive://BINDING_NAME
