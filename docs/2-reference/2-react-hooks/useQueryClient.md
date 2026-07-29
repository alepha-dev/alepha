# useQueryClient

## Import

```typescript
import { useQueryClient } from "alepha/react";
```

## Overview

Imperative access to the query cache used by `useQuery`.

Most invalidation should be declarative — `useAction({ invalidates })` —
because it keeps the write and the keys it affects in one place. Reach for
this hook when the trigger is not a `useAction`: a websocket message, a
router event, or an optimistic write applied before the request settles.

```tsx
const queries = useQueryClient();

useEvents({
  "folio:updated": ({ campaignId }) => {
    queries.invalidate(["folios", campaignId]);
  },
}, []);
```

