# useQuery

## Import

```typescript
import { useQuery } from "alepha/react";
```

## Overview

Hook for declarative data fetching with automatic execution and refetch.

Thin wrapper over {@link useAction}: it pre-applies `runOnInit: true`,
exposes the last result as `data`, and provides a stable `refetch()` to
re-run the query on demand. For optimistic mutations and side-effects,
use {@link useAction} directly — `useQuery` is for the read path.

Caching, request deduplication, and AbortSignal cancellation come from
`useAction` + `HttpClient`. There is no separate cache layer — pass
`localCache` to your `HttpClient.fetch()`/`fetchAction()` call inside
the query handler if you want per-call caching.

## Examples

Basic
```tsx
const client = useInject(HttpClient);
const { data, loading, error, refetch } = useQuery({
  handler: async ({ signal }) => {
    const res = await client.fetch("/api/users", { request: { signal } });
    return res.data;
  },
}, []);
```

Re-fetch when a dep changes
```tsx
const { data } = useQuery({
  handler: async () => api.getUser(userId),
}, [userId]);
```

Polling
```tsx
const { data } = useQuery({
  handler: async () => api.getStatus(),
  runEvery: [5, "seconds"],
}, []);
```

