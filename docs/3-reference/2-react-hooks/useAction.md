# useAction

## Import

```typescript
import { useAction } from "alepha/react";
```

## Overview

Hook for handling async actions with automatic error handling and event emission.

By default, prevents concurrent executions - if an action is running and you call it again,
the second call will be ignored. Use `debounce` option to delay execution instead.

Emits lifecycle events:
- `react:action:begin` - When action starts
- `react:action:success` - When action completes successfully
- `react:action:error` - When action throws an error
- `react:action:end` - Always emitted at the end

## Examples

Basic usage
```tsx
const action = useAction({
  handler: async (data) => {
    await api.save(data);
  }
}, []);

<button onClick={() => action.run(data)} disabled={action.loading}>
  Save
</button>
```

With debounce (search input)
```tsx
const search = useAction({
  handler: async (query: string) => {
    await api.search(query);
  },
  debounce: 300 // Wait 300ms after last call
}, []);

<input onChange={(e) => search.run(e.target.value)} />
```

Run on component mount
```tsx
const fetchData = useAction({
  handler: async () => {
    const data = await api.getData();
    return data;
  },
  runOnInit: true // Runs once when component mounts
}, []);
```

Run periodically (polling)
```tsx
const pollStatus = useAction({
  handler: async () => {
    const status = await api.getStatus();
    return status;
  },
  runEvery: 5000 // Run every 5 seconds
}, []);

// Or with duration tuple
const pollStatus = useAction({
  handler: async () => {
    const status = await api.getStatus();
    return status;
  },
  runEvery: [30, 'seconds'] // Run every 30 seconds
}, []);
```

With AbortController
```tsx
const fetch = useAction({
  handler: async (url, { signal }) => {
    const response = await fetch(url, { signal });
    return response.json();
  }
}, []);
// Automatically cancelled on unmount or when new request starts
```

With error handling
```tsx
const deleteAction = useAction({
  handler: async (id: string) => {
    await api.delete(id);
  },
  onError: (error) => {
    if (error.code === 'NOT_FOUND') {
      // Custom error handling
    }
  }
}, []);

{deleteAction.error && <div>Error: {deleteAction.error.message}</div>}
```

Global error handling
```tsx
// In your root app setup
alepha.events.on("react:action:error", ({ error }) => {
  toast.danger(error.message);
  Sentry.captureException(error);
});
```

