# React Integration

Alepha provides first-class React support with server-side rendering, dependency injection in components, type-safe API calls, and a global state system.

## Project Setup

Scaffold a project:

```bash
npm create alepha my-app
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

  return <button onClick={() => inc.run()}>Click {count}</button>;
};
```

The type parameter `<CountApi>` provides full type safety - method names, parameter types, and return types are all inferred from the controller class.

`useClient` takes the same scope as `$client()`. A `hostname` in it (`useClient<BillingApi>({ hostname: "https://billing.example.com" })`) reaches another Alepha app instead of this one; such a client offers actions only, not `$sse` streams. See [HTTP Links](/docs/guides-server-http-links).

### useAction

Manages async operations with loading state, error handling, cancellation, debounce, and polling.

```typescript check
import { useAction } from "alepha/react";
```

**Returns:** `{ run, refetch, loading, error, cancel, result }`

| Property  | Type                              | Description                                                                                           |
| --------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `run`     | `(...args) => Promise<RunResult>` | Execute the action. Never rejects (see below)                                                         |
| `refetch` | `(...args) => Promise<RunResult>` | Re-execute the action, aborting any in-flight request (never dropped by the double-click dedup guard) |
| `loading` | `boolean`                         | True while executing                                                                                  |
| `error`   | `Error \| undefined`              | Error from last failed execution                                                                      |
| `cancel`  | `() => void`                      | Cancel debounce timer or abort in-flight                                                              |
| `result`  | `T \| undefined`                  | Result from last successful execution                                                                 |

**Options:**

| Option        | Type                                     | Description                                                                                                                                                                                                                                                                                                                                |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handler`     | `(ctx, ...args) => Promise`              | The async function to execute. Receives an `ActionContext` (`{ signal }`) FIRST, then the arguments given to `run`.                                                                                                                                                                                                                        |
| `onError`     | `(error) => void`                        | Custom error handler. Passing one marks the failure handled: `react:action:error` still fires, with `handled: true`, and `ActionErrorToaster` does not toast it (see below). Errors are never re-thrown by `run`: they land in its result, in `error` state and in the event, so fire-and-forget calls can't produce unhandled rejections. |
| `onSuccess`   | `(result) => void`                       | Called after successful execution.                                                                                                                                                                                                                                                                                                         |
| `id`          | `string`                                 | Identifier for debugging and analytics.                                                                                                                                                                                                                                                                                                    |
| `debounce`    | `number`                                 | Delay in milliseconds before executing.                                                                                                                                                                                                                                                                                                    |
| `runOnInit`   | `boolean`                                | Run when the component mounts, and again whenever the dependency list changes (the new run supersedes one still in flight).                                                                                                                                                                                                                |
| `runEvery`    | `DurationLike`                           | Run periodically at the given interval.                                                                                                                                                                                                                                                                                                    |
| `invalidates` | `unknown[][] \| (result) => unknown[][]` | Query-cache keys to invalidate after success - see [Invalidating after a write](#invalidating-after-a-write).                                                                                                                                                                                                                              |

**`run` resolves a `RunResult` and never rejects:**

| Result                                  | When                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `{ ok: true, value }`                   | The handler returned `value`.                                                                |
| `{ ok: false, reason: "error", error }` | The handler threw `error`.                                                                   |
| `{ ok: false, reason: "dropped" }`      | Refused because a run was already in flight, or a `debounce`d call replaced by a newer one.  |
| `{ ok: false, reason: "aborted" }`      | Cancelled by `cancel()`, an unmount or a newer run.                                          |
| `{ ok: false, reason: "cancelled" }`    | A wrapper hook's user backed out (a declined confirm); `useAction` itself never produces it. |

So a follow-up branches on it: `if ((await save.run()).ok) close();`. By default, concurrent executions are prevented, which is the `dropped` case: disable the controls that trigger the action on `loading`. `refetch` and a `debounce`d call abort the in-flight run and replace it instead.

`run` is not an event handler: write `onClick={() => save.run()}`, never `onClick={save.run}`, which would pass the click event as the first argument.

**Debounce example (search input):**

```tsx
const search = useAction(
  {
    handler: async (_ctx, query: string) => {
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
    handler: async ({ signal }, url: string) => {
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
alepha.events.on("react:action:error", ({ error, handled }) => {
  if (handled) return;
  toast.danger(error.message);
});
```

**A handled error stays quiet.** The error event carries `handled: true` when the caller already dealt with the failure: the `useAction`, `useQuery` or `useForm` was given an `onError`, or the error says it is shown in place (`shownInPlace`), as a form's `FormValidationError` naming a field does. Every emitter (`useAction`, `useQuery`, `FormModel`, the DataTable) derives it the same way, through `ActionErrorPolicy`. `@alepha/ui`'s `ActionErrorToaster` skips a handled error, so `onError: () => {}` is how a read that can do without its data stays quiet, and an `onError` that toasts its own message does not get a second toast beside it. The event still fires either way: error reporting, such as the `@alepha/lore` browser sigil, reads a quiet failure too.

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

Alepha reports it on `react:render:recovered`:

```typescript
alepha.events.on(
  "react:render:recovered",
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

## Render crashes an error boundary caught

A page that throws while rendering is caught by the error boundary the router
mounts around every page and overlay, and the visitor sees its fallback. React
fires **no** `window.onerror` for an error a boundary caught, so a crash
reporter listening there never hears it.

Alepha reports it on `react:render:caught`, for the router's boundaries and any
`ErrorBoundary` the app mounts itself:

```typescript
alepha.events.on("react:render:caught", ({ error, componentStack, state }) => {
  console.error(`Render crash on ${state?.url.pathname}`, componentStack);
});
```

`state` is the router state at the moment of the crash, so a crash after a
navigation names the page it happened on. `@alepha/lore` reports these the same
way as a hydration mismatch.

## Data fetching and cache invalidation

`useQuery` (from `alepha/react`) is `useAction` pre-wired for reads: it runs on mount and whenever its dependency list changes, and returns `{ data, loading, error, refetch, cancel, isStale }`. It works without a cache - pass a handler, get `data` / `loading` / `error` / `refetch`. Pass a `key` and it joins a shared cache.

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

**Options** (besides `handler`, which receives `{ signal }`):

| Option               | Default | Description                                                                                            |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `key`                | none    | Cache key (an array). Without it, nothing is shared or cached.                                         |
| `staleTime`          | `0`     | `DurationLike`. While an entry is fresh, mounting renders it from cache without fetching.              |
| `keepPreviousData`   | `false` | Keep rendering the previous key's data while a new key loads (pagination, filters). Requires `key`.    |
| `enabled`            | `true`  | `false` skips the automatic runs (mount, dependency change, `runEvery`); `refetch()` still works.      |
| `initialData`        | none    | Value of `data` before the first successful fetch.                                                     |
| `runEvery`           | none    | Poll at this interval, as in `useAction`. Paused while the page is hidden.                             |
| `refetchOnReconnect` | `true`  | Re-run a stale or failed keyed query when the browser comes back online.                               |
| `refetchOnFocus`     | `false` | Re-run a stale keyed query when the page becomes visible again.                                        |
| `retry`              | `2`     | Retries of a failed read: a number, `false`, or `(error, attempt) => boolean`. See "Retries" below.    |
| `debounce`           | none    | Debounce delay in milliseconds.                                                                        |
| `onSuccess`          | none    | Called with the resolved value.                                                                        |
| `onError`            | none    | Marks the failure handled: `onError: () => {}` is how a read that can do without its data stays quiet. |
| `id`                 | none    | Identifier carried by the `react:action:*` events.                                                     |

`loading` is already `true` on the very first render of an enabled query with no `initialData`, so a skeleton renders without a flash of empty content. `isStale` is `true` when a cached entry outlived `staleTime` and is being revalidated in the background.

A key buys four things:

- **Sharing.** Two components on the same key read one entry instead of each fetching.
- **Deduplication.** Two components mounting on the same key in one tick share a single in-flight request - the second joins the first rather than issuing its own.
- **`staleTime`.** While an entry is fresh, mounting renders it straight from cache with no network call and `loading: false`.
- **SSR hydration.** The cache is a registered atom, so a server-rendered result arrives in the hydration payload for free.

### Retries

A failed read is tried again twice by default, after 1 s and then 2 s (the wait doubles up to 30 s, with jitter). Only what may succeed when sent again is retried: no HTTP response at all (a network failure), or a 408, 502, 503 or 504, a `TimeoutError` included. An abort, another 4xx, a 429, a 500 (a defect, which fails the same way twice) or a plain `Error` fails at once.

`loading` stays `true` across the retries, and `error`, `onError` and the toast arrive once, after the last attempt. An unmount, a dependency change, `refetch()` or `cancel()` stops the sequence. Two components on one key share one sequence. `useAction` never retries: a write is not idempotent.

```tsx
useQuery({ key: ["basket"], handler, retry: 0 }, []); // this query only
useQuery(
  {
    handler,
    retry: (error, attempt) => attempt <= 5 && isRetryableError(error),
  },
  [],
);

alepha.store.mut(queryOptionsAtom, (options) => ({ ...options, retry: 0 })); // the whole app, or one spec file
```

A spec asserting the error of a retried failure either travels past the backoff with `DateTimeProvider.travel()`, or sets `retry: 0` on the query or in the atom.

### Refetch on reconnect and on tab return

A keyed query re-runs itself when the app comes back, keeping its entry so `data` stays on screen while the request runs:

- **`refetchOnReconnect`** (default `true`): when the browser comes back online, every mounted keyed query whose entry is stale, or whose last run failed, re-runs. A read that failed while a phone was offline recovers on its own.
- **`refetchOnFocus`** (default `false`): when the page becomes visible again, every mounted keyed query whose entry is stale re-runs. It is off by default because `staleTime` defaults to `0`, so every entry is stale: turned on app-wide, a tab return sends one request per mounted keyed query. Set it on the query that needs it (a basket, a price), with a `staleTime` to bound how often it asks.

```tsx
useQuery(
  {
    key: ["basket"],
    handler,
    refetchOnFocus: true,
    staleTime: [30, "seconds"],
  },
  [],
);

alepha.store.mut(queryOptionsAtom, (options) => ({
  ...options,
  refetchOnReconnect: false,
}));
```

A keyless query has no entry and no staleness, and never refetches on either event. Two components on one key send one request. The events are `visibilitychange` and `online`, one listener each per container, browser only; a native shell substitutes `QueryWakeEvents` to listen to its own resume and network events.

**Polling pauses while the page is hidden.** A `runEvery` tick, on `useQuery` or `useAction`, is skipped while `document.hidden`, and the poll resumes at its next tick. There is no switch to keep polling in the background.

### Invalidating after a write

This is the part that replaces hand-patching state after a mutation. Declare what a write affects and mounted queries refetch themselves:

```tsx
const remove = useAction(
  {
    handler: async (_ctx, id: string) => folioApi.delete({ params: { id } }),
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
queries.get(["folio", id]); // read without subscribing
queries.clear(); // drop everything; mounted queries refetch
```

The app never needs `clear()` on a sign-out: see "Eviction and a change of user" below.

### Eviction and a change of user

An entry no mounted query reads is dropped 5 minutes after its last reader left, and never before the `staleTime` it was read with has run out, so a query with `staleTime: [10, "minutes"]` remounted after 6 minutes still renders from cache. An entry nothing ever read (hydrated from the server, or written by `setData`) is dropped 5 minutes after it was written. A remount before then cancels it. The delay is app-wide, `gcTime` in `queryOptionsAtom`; `false` keeps every entry for the life of the page:

```tsx
alepha.store.mut(queryOptionsAtom, (options) => ({
  ...options,
  gcTime: false,
}));
```

When the signed-in user changes inside the page, `alepha/react/auth` empties the whole cache. On a sign-out (the user becomes nobody) no mounted query refetches, since the page is being left; on a sign-in or a switch of account, mounted queries re-run under the new identity. On the web a sign-out is a full navigation anyway; this matters in a native shell, which signs out in place, and after a cookie sign-in that does not reload.

On the server no eviction timer runs: the cache lives in the request's state and dies with it, and no in-flight request is ever shared between two visitors.

### Optimistic writes with Undo

A write the reader should see land in the frame of their click, with a way back, uses `useUndoable` from `@alepha/ui`. `run()` changes the screen first, raises a toast with an Undo button, then talks to the server:

```tsx
const undoable = useUndoable();

// In a DataTable row action: `ctx.optimistic` hides or redraws the row
// at once, and lets go once a reload sent after the write has answered.
const archive = (task: Task, ctx: RowActionContext<Task>) =>
  void undoable.run({
    message: `${task.title} archived`,
    apply: () => ctx.optimistic.remove(task),
    commit: () => taskApi.archive({ params: { id: task.id } }),
    undo: () => taskApi.unarchive({ params: { id: task.id } }),
  });
```

The presence of `undo` picks the mode:

- **With `undo`**, the write is sent at once and Undo sends the inverse. The server is the truth from the first second.
- **Without it**, the write is held until the toast closes (or the page is hidden), and Undo simply never sends it. This is the mode for a delete, which has no inverse, and for a write whose inverse loses something.

`run()` never rejects: a refused write is rolled back and reported on `react:action:error`, so the root `ActionErrorToaster` shows it. `Ctrl+Z` / `Cmd+Z` undoes the newest toast outside a text field. Call it from the click itself rather than from inside a `useAction`, which awaits its `react:action:begin` listeners before the handler runs.

In a `DataTable`, row and bulk actions also receive `ctx.reload()`, which fetches the page the reader is on again without the skeleton or the jump to page one that `ctx.refresh()` makes. Rows that leave, arrive, move or change are animated, except on a page, filter or sort change and under `prefers-reduced-motion`.

### `useQuery` or `$page.loader`?

Both fetch. The dividing line is whether the route can render without the data:

- **`$page.loader`**: the page is meaningless without it (the folio being viewed). It runs before render, so there is no loading state to design, and it participates in SSR.
- **`useQuery`**: a component owns the data and can render a skeleton while it arrives (a sidebar, a backlinks panel, a tag list). It is also the right choice for anything a mutation should be able to invalidate.

Mixing them is normal: load the subject in the route, query its satellites in components.

## ClientOnly and ErrorBoundary

`alepha/react` ships three components. `ClientOnly` and `ErrorBoundary` are shown here; the third, `<Personal>`, keeps the visitor-specific part of a page (a user menu) out of a cached render, see [Page Cache](/docs/guides-frontend-page-cache).

```tsx check
import { ClientOnly, ErrorBoundary } from "alepha/react";

const Clock = () => (
  <ErrorBoundary
    fallback={(error, reset) => (
      <button onClick={reset}>{error.message}</button>
    )}
  >
    <ClientOnly fallback={<span>--:--</span>}>
      {new Date().toLocaleTimeString()}
    </ClientOnly>
  </ErrorBoundary>
);
```

- `<ClientOnly fallback? disabled?>` renders its children only after hydration, and `fallback` during the server render and the hydration pass. Use it for browser-only reads (see [Hydration mismatches](#hydration-mismatches)).
- `<ErrorBoundary fallback onError? resetKeys?>` catches render errors below it. `fallback(error, reset)` is required; `resetKeys` clears a caught error when any of the values changes, without remounting the children. Every page is already wrapped in one by the router.

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
