# $transaction

> Creates a transaction primitive for database operations requiring atomicity and consistency.

## Import

```typescript
import { $transaction } from "alepha/orm";
```

## Overview

Creates a transaction primitive for database operations requiring atomicity and consistency.

This primitive provides a convenient way to wrap database operations in PostgreSQL
transactions, ensuring ACID properties and automatic retry logic for version conflicts.
It integrates seamlessly with the repository pattern and provides built-in handling
for optimistic locking scenarios with automatic retry on version mismatches.

**Important Notes**:
- All operations within the transaction handler are atomic
- Automatic retry on `PgVersionMismatchError` for optimistic locking
- Pass `{ tx }` option to all repository operations within the transaction
- Transactions are automatically rolled back on any unhandled error
- Use appropriate isolation levels based on your consistency requirements

