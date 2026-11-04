# DatabaseMemoryPaymentProvider

## Import

```typescript
import { DatabaseMemoryPaymentProvider } from "alepha/api/payments";
```

## Overview

`MemoryPaymentProvider` whose state lives in the `cache_entries` table
instead of in-process Maps.

The plain mock forgets everything between two isolates, so on Cloudflare
Workers a card saved at checkout may be gone when the next request reads
it. This one keeps every session, card, charge and refund in the
database (strongly consistent on D1), so a deployed QA environment can run a
whole paid flow with no PSP account. It is still a mock: every checkout is
paid and no money moves, so the application decides when to bind it.

Needs `AlephaCacheDatabase` registered (the table). Entries expire after
`ttl`, so an abandoned QA flow does not grow the table for ever.

The sync test helpers (`wasCharged`, `getCharges`, ...) read the in-process
Maps and see nothing here; assert on the database instead.
