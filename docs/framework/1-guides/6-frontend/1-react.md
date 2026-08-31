# React Integration

Alepha provides first-class React support with server-side rendering, dependency injection in components, type-safe API calls, and a global state system.

## Project Setup

Scaffold a project with the Alepha CLI:

```bash
alepha init my-app
```

React, SSR and Tailwind are part of every Alepha project - there is no flag to enable them. This generates two entry points:

- `src/main.server.ts`: server entry, registers the API and web modules and starts the app
- `src/main.browser.ts`: browser entry, registers the web module and hydrates

**Server entry (`main.server.ts`):**

```typescript
import { Alepha, run } from "alepha";
import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(ApiModule);
alepha.with(WebModule);

run(alepha);
```

**Browser entry (`main.browser.ts`):**

```typescript
import { Alepha, run } from "alepha";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(WebModule);

run(alepha);
```

The browser entry only registers the modules needed on the client (e.g., routes, UI). Server-only modules like API controllers are excluded.

## Core Hooks

All core React hooks are imported from `"alepha/react"`.

### useAlepha

Returns the current Alepha instance from context. Provides access to the DI container, event system, and store.

```typescript check
import { useAlepha } from "alepha/react";

const MyComponent = () => {
  const alepha = useAlepha();
  // alepha.inject(SomeService)
  // alepha.events.emit(...)
  // alepha.store.get(...)
};
```

Must be used within an Alepha context (provided automatically by the router or by `<AlephaProvider>`).

### useInject

Injects a DI service into a React component. The service must be registered with the Alepha instance. Result is memoized.

```typescript
import { useInject } from "alepha/react";

const Dashboard = () => {
  const analytics = useInject(AnalyticsService);
  // use analytics methods
};
```

### useClient

Type-safe API calls from React. Connects to server-side controllers via the link system. Works with SSR - on the server, calls are made internally without HTTP.

```tsx
import { useAction, useClient } from "alepha/react";
import { useState } from "react";
import type { CountApi } from "./CountApi.ts";

interface HomeProps {
  count: number;
}

const Home = (props: HomeProps) => {
  const [count, setCount] = useState(props.count);
  const countApi = useClient<CountApi>();

  const inc = useAction(
    {
      handler: async () => {
        const result = await countApi.inc();
        setCount(result.count);
      },
    },
    [count],
  );

  return <button onClick={inc.run}>Click {count}</button>;
};
```

The type parameter `<CountApi>` provides full type safety - method names, parameter types, and return types are all inferred from the controller class.

### useAction

Manages async operations with loading state, error handling, cancellation, debounce, and polling.

```typescript check
import { useAction } from "alepha/react";
```

**Returns:** `{ run, refetch, loading, error, cancel, result }`

| Property  | Type                   | Description                                                                                           |
| --------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `run`     | `(...args) => Promise` | Execute the action                                                                                    |
| `refetch` | `() => Promise`        | Re-execute the action, aborting any in-flight request (never dropped by the double-click dedup guard) |
| `loading` | `boolean`              | True while executing                                                                                  |
| `error`   | `Error \| undefined`   | Error from last failed execution                                                                      |
| `cancel`  | `() => void`           | Cancel debounce timer or abort in-flight                                                              |
| `result`  | `T \| undefined`       | Result from last successful execution                                                                 |

**Options:**

| Option        | Type                        | Description                                                                                                                                                                             |
| ------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler`     | `(...args, ctx) => Promise` | The async function to execute. Receives an `ActionContext` with an `AbortSignal` as the last argument.                                                                                  |
| `onError`     | `(error) => void`           | Custom error handler. Errors are never re-thrown by `run` - they land in `error` state and the `react:action:error` event, so fire-and-forget calls can't produce unhandled rejections. |
| `onSuccess`   | `(result) => void`          | Called after successful execution.                                                                                                                                                      |
| `id`          | `string`                    | Identifier for debugging and analytics.                                                                                                                                                 |
| `debounce`    | `number`                    | Delay in milliseconds before executing.                                                                                                                                                 |
| `runOnInit`   | `boolean`                   | Run once when the component mounts.                                                                                                                                                     |
| `runEvery`    | `DurationLike`              | Run periodically at the given interval.                                                                                                                                                 |
| `invalidates` | `string[]`                  | Query-cache keys to invalidate after success - see [Invalidating after a write](#invalidating-after-a-write).                                                                           |

By default, concurrent executions are prevented - calling `run` while already executing is a no-op.

**Debounce example (search input):**

```tsx
const search = useAction(
  {
    handler: async (query: string) => {
      return await api.search(query);
    },
    debounce: 300,
  },
  [],
);

// <input onChange={(e) => search.run(e.target.value)} />
```

**Polling example:**

```typescript
const pollStatus = useAction(
  {
    handler: async () => {
      return await api.getStatus();
    },
    runEvery: 5000,
  },
  [],
);

// Or with duration tuple:
// runEvery: [30, "seconds"]
```

**AbortController example:**

```typescript
const fetchData = useAction(
  {
    handler: async (url: string, { signal }: { signal: AbortSignal }) => {
      const response = await fetch(url, { signal });
      return response.json();
    },
  },
  [],
);
// Automatically cancelled on unmount or when a new request starts
```

**Lifecycle events:**

Actions emit events on the Alepha event system:

- `react:action:begin`: action started
- `react:action:success`: action completed successfully
- `react:action:error`: action threw an error
- `react:action:end`: always emitted at the end

Global error handling example:

```typescript
alepha.events.on("react:action:error", ({ error }) => {
  toast.danger(error.message);
});
```

### useEvents

Subscribe to Alepha events inside React components. Subscriptions are automatically cleaned up on unmount.

```tsx check
import { useEvents } from "alepha/react";

const StatusBar = () => {
  useEvents(
    {
      "react:transition:begin": (ev) => {
        console.log("Navigating to:", ev.state.url.pathname);
      },
      "react:action:error": (ev) => {
        console.error("Action failed:", ev.error);
      },
    },
    [],
  );

  return <div>...</div>;
};
```

The second argument is a dependency list (same as `useEffect`). Events are fully typed based on the `Hooks` interface. Note that `useEvents` no-ops outside the browser - an SSR pass registers nothing, so don't rely on it for server-side listeners.

## Hydration mismatches

When the server-rendered HTML and the first client render disagree, React
**recovers**: it re-renders the offending subtree on the client, so the visitor
sees a correct page. Nothing throws and no error boundary fires. It is still a
defect - the page paints twice, and whatever made the two renders differ is
usually a browser-only read during render.

Alepha reports it on `react:recoverable:error`:

```typescript
alepha.events.on(
  "react:recoverable:error",
  ({ error, componentStack, state }) => {
    console.error(
      `Hydration mismatch on ${state.url.pathname}`,
      componentStack,
    );
  },
);
```

`componentStack` names the subtree that mismatched, and React fills it **even
in a production build** - which is the whole reason to listen here rather than
on `window.onerror`. React's own default handler calls `reportError`, so a
production mismatch reaches `window.onerror` as a minified code with its
arguments blanked: no route, no component, nothing to open.

⚠️ **Alepha passes `onRecoverableError` to `hydrateRoot` and `createRoot`,
which replaces that default.** These errors therefore no longer reach
`window.onerror` at all. A crash reporter that listened there has to subscribe
to this event instead - which is what `@alepha/lore` does, appending
`componentStack` to the reported stack so two mismatches in different subtrees
are two rows rather than one.

The event is not hydration-only, despite hydration being where it usually comes
from: a root keeps the handler for its whole life, so an error a Suspense
boundary retried past arrives here too.

The usual causes, in order of how often they turn out to be it:

- reading `localStorage`, `matchMedia`, `navigator` or `window` during render
  instead of in an effect;
- `new Date()` or `Math.random()` in a `useState` initialiser;
- markup a browser extension injected into the hydrated subtree.

The fix is the same each time: render what the server rendered, then correct it
in an effect after mount.

## Data fetching and cache invalidation

`useQuery` works without a cache - pass a handler, get `data` / `loading` / `error` / `refetch`. Pass a `key` and it joins a shared cache.

```tsx
const { data, loading, isStale } = useQuery(
  {
    key: ["folios", campaignId],
    handler: async ({ signal }) =>
      folioApi.list({ params: { campaignId } }, { request: { signal } }),
  },
  [campaignId],
);
```

A key buys four things:

- **Sharing.** Two components on the same key read one entry instead of each fetching.
- **Deduplication.** Two components mounting on the same key in one tick share a single in-flight request - the second joins the first rather than issuing its own.
- **`staleTime`.** While an entry is fresh, mounting renders it straight from cache with no network call and `loading: false`.
- **SSR hydration.** The cache is a registered atom, so a server-rendered result arrives in the hydration payload for free.

### Invalidating after a write

This is the part that replaces hand-patching state after a mutation. Declare what a write affects and mounted queries refetch themselves:

```tsx
const remove = useAction(
  {
    handler: async (id: string) => folioApi.delete({ params: { id } }),
    invalidates: [
      ["folios", campaignId],
      ["folioTags", campaignId],
    ],
  },
  [campaignId],
);
```

Keys are arrays and matching is by **prefix**, so `["folios"]` drops `["folios", 1]` and `["folios", 2]` without the mutation needing to know which campaigns were queried. It will not touch `["folios-archive"]`.

Pass a function when the keys depend on the result:

```tsx
invalidates: (created) => [["folios", created.campaignId]],
```

### Imperative access

When the trigger is not a `useAction` - a websocket message, a router event, an optimistic write - use `useQueryClient`:

```tsx
const queries = useQueryClient();

queries.invalidate(["folios", campaignId]);
queries.setData(["folio", id], (previous) => ({ ...previous, pinned: true }));
queries.clear(); // on logout
```

### `useQuery` or `$page.loader`?

Both fetch. The dividing line is whether the route can render without the data:

- **`$page.loader`**: the page is meaningless without it (the folio being viewed). It runs before render, so there is no loading state to design, and it participates in SSR.
- **`useQuery`**: a component owns the data and can render a skeleton while it arrives (a sidebar, a backlinks panel, a tag list). It is also the right choice for anything a mutation should be able to invalidate.

Mixing them is normal: load the subject in the route, query its satellites in components.

## AlephaProvider

Only needed if you are **not** using the Alepha Router (e.g., in Expo or Next.js integrations). When using `$page` and the router, the context is provided automatically.

```tsx
import { AlephaProvider } from "alepha/react";

const App = () => {
  return (
    <AlephaProvider
      onLoading={() => <div>Loading...</div>}
      onError={(error) => <div>Error: {error.message}</div>}
    >
      <MyApp />
    </AlephaProvider>
  );
};
```

`AlephaProvider` creates an Alepha instance, calls `start()`, and provides the instance via React context. Props:

| Prop        | Type                          | Description                       |
| ----------- | ----------------------------- | --------------------------------- |
| `children`  | `ReactNode`                   | Application content               |
| `onLoading` | `() => ReactNode`             | Rendered while Alepha is starting |
| `onError`   | `(error: Error) => ReactNode` | Rendered if start fails           |
