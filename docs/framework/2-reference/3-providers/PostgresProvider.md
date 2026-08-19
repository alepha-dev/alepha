# PostgresProvider

## Import

```typescript
import { PostgresProvider } from "alepha/orm/postgres";
```

## Overview

Abstract base class for PostgreSQL database providers.

Provides shared logic for Node.js and Bun PostgreSQL providers:
- Environment variable handling (DATABASE_URL, POSTGRES_SCHEMA)
- Schema name resolution (with test schema generation)
- SQL execution with error wrapping
- Lifecycle hooks (start with migration lock, stop with test cleanup)

Subclasses must implement `connect()`, `close()`, and `runMigrator()`.

