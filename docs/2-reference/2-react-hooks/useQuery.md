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

Request deduplication and AbortSignal cancellation come from `useAction` +
`HttpClient`.

Pass a `key` to opt into the shared query cache: components using the same
key read one entry rather than each fetching, `staleTime` serves a fresh
entry without hitting the network, and a mutation declaring
`invalidates: [["folios"]]` drops every entry under that prefix and makes
mounted queries refetch. The cache lives in a registered atom, so
server-rendered results hydrate on the client for free.

Without a `key`, none of that applies and the hook behaves exactly as it
always has — no cache reads, no cache writes, no shared state.

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

