# InfraCacheProvider

## Import

```typescript
import { InfraCacheProvider } from "alepha/cli/infra-lib";
```

## Overview

Caches cloud provider login state to avoid slow auth checks.

Stored in node_modules/.alepha/platform.json (gitignored, project-scoped).
TTL: 4 hours.
