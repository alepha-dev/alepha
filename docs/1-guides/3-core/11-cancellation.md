# Cancellation

Work that nobody is waiting for anymore should stop. A visitor closes the tab,
an operator cancels a job, an MCP client gives up on a tool call, the app is
asked to stop: the work behind each of them is still running, and so is every
outbound call, query and child process it started.

Alepha gives every unit of work one `AbortSignal` and keeps it in the context.
You never pass it down: the framework's own consumers read it, and so can your
code.

```typescript check
import { $inject, Alepha } from "alepha";

class Exporter {
  protected readonly alepha = $inject(Alepha);

  async exportAll(ids: string[]): Promise<string[]> {
    const rows: string[] = [];
    for (const id of ids) {
      // Throws the signal's reason once the request, job or call is gone.
      this.alepha.context.signal.throwIfAborted();
      rows.push(await this.render(id));
    }
    return rows;
  }

  protected async render(id: string): Promise<string> {
    return id;
  }
}
```

`alepha.context.signal` is never `undefined`. Outside any unit of work it is
the app signal, which aborts when `alepha.stop()` begins.

## Where the signal comes from

| Unit of work          | Its signal aborts when                                                             |
| --------------------- | ---------------------------------------------------------------------------------- |
| An HTTP request       | the client disconnects before the response is complete (`ServerRequest.signal`)    |
| A `$job` execution    | it is cancelled, or still running when stop's drain deadline passes, or times out  |
| A queue message       | still being processed when the workers' `drainTimeout` passes at stop              |
| A cron tick           | its task stops                                                                     |
| An MCP tool call      | the client cancels it (`notifications/cancelled`), or its HTTP request disconnects |
| A `$sse` handler      | the stream ends: the client leaves, `close()` is called, or the handler finishes   |
| A WebSocket admission | the socket closes before the upgrade was decided                                   |
| A CLI command         | the process receives SIGINT or SIGTERM                                             |

On Node the disconnect is the response's socket closing before the response
finished. On Bun and Cloudflare Workers it is the runtime's own
`request.signal`; on Workers that needs the `enable_request_signal`
compatibility flag, which `alepha build` writes into `wrangler.jsonc`, also
when the app supplies its own flag list.

The public `signal` parameters stay where they are (`$job`'s handler,
`$sse`'s context, `McpContext.signal`, `ServerRequest.signal`), and each is
the same object as `alepha.context.signal` inside that handler.

A unit of work does not abort when stop begins. The server, jobs and queue
workers drain first, and abort what is still running at their own deadline.

## What inherits it

Without anyone passing a signal:

- **`HttpClient`** (and so remote actions and links) passes it to `fetch`. A
  deduplicated GET shared by several callers is aborted only once its last
  caller has gone, so one visitor leaving never fails another's call.
- **`ShellProvider`** kills its child process.
- **`$proxy`** stops the upstream call.
- **The ORM** refuses a read whose signal already fired, and cancels a running
  one where the driver can (postgres.js: Node and Hyperdrive). `Bun.sql`,
  PGlite, SQLite and D1 refuse before sending but let a started query finish.
- **SSR** stops rendering a page for a visitor who left.

An explicit `signal` still wins, and composes with the ambient one: either can
abort the call.

### Writes and transactions are never cut short

The ORM treats writes differently on purpose. Cutting a sequence of writes in
half leaves work that nothing undoes: a payment captured with no order.

- A **read** outside a transaction inherits the signal.
- A **write** outside a transaction does not. It still honors a `signal` you
  pass explicitly.
- A **transaction** checks the signal before `BEGIN` only. Once begun it runs
  to commit, or rolls back on its own error, whatever happens to its caller.

```typescript
const rows = await users.findMany({ where: { active: { eq: true } } });
// Explicit: refused before it is sent if `signal` already fired.
await users.create({ name: "Ada" }, { signal });
```

## Narrowing it: `withSignal`

`withSignal(signal, fn)` runs `fn` under a signal that aborts when either the
current one or `signal` does. It can only narrow, never widen: the work still
stops when its request does.

```typescript check
import { $inject, Alepha } from "alepha";
import { HttpClient } from "alepha/server";

class Quotes {
  protected readonly alepha = $inject(Alepha);
  protected readonly http = $inject(HttpClient);

  latest() {
    // Five seconds at most, and never past the caller's own signal.
    return this.alepha.context.withSignal(AbortSignal.timeout(5_000), () =>
      this.http.fetch("https://quotes.example.com/latest"),
    );
  }
}
```

## Opting out: `detachSignal`

`detachSignal(fn)` runs `fn` under the app signal instead of the current one:
for work that must finish after the client left, such as notifying a webhook
once an order is placed.

```typescript check
import { $inject, Alepha } from "alepha";
import { HttpClient } from "alepha/server";

class OrderEvents {
  protected readonly alepha = $inject(Alepha);
  protected readonly http = $inject(HttpClient);

  placed(orderId: string) {
    // Survives the visitor closing the tab.
    void this.alepha.context.detachSignal(() =>
      this.http.fetch("https://hooks.example.com/orders", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      }),
    );
  }
}
```

Detached work still dies at app stop: the app signal is what it runs under.
Work that must survive a shutdown, or a crash, belongs in a `$job`, which is
recorded before it runs and retried after.

## An abort is not an error

Work cut short because nobody is listening is an outcome, not a failure, and
the framework never reports it as one:

- A request aborted by its client skips `server:request:error` and the
  response hooks, writes nothing to the dead socket, and logs one debug line
  with the status it would have had, 499.
- A job execution aborted by a cancel or the drain is recorded `cancelled`,
  never `error`, and is not retried.
- An aborted outbound call or child process is logged at debug.

Classify an error the same way in your own code with `isAbortError`:

```typescript check
import { $inject, Alepha } from "alepha";

class Sync {
  protected readonly alepha = $inject(Alepha);

  async run(step: () => Promise<void>): Promise<"done" | "stopped"> {
    try {
      await step();
      return "done";
    } catch (error) {
      if (this.alepha.context.isAbortError(error)) {
        return "stopped";
      }
      throw error;
    }
  }
}
```

It answers `true` for the signal's own reason once it aborted, for an
`AbortedError` (the reason every framework abort carries, naming who
aborted), and for a `DOMException` named `AbortError`, also when wrapped as a
`cause`. A real failure that happens after an unrelated abort reports normally.

## Timeouts

A timeout is an abort with a reason: the work did not finish in the time it
was given. The work's signal aborts with a `TimeoutError` (status 503), so
everything downstream stops as it would on a disconnect, and the caller is
answered at the deadline, even when the code ignores its signal.

| Where                  | Option    | Default                                          |
| ---------------------- | --------- | ------------------------------------------------ |
| `$action`              | `timeout` | none; `serverApiOptions.timeout` (ms) sets one   |
| `$tool`                | `timeout` | none; `mcpToolOptions.timeout` (ms) sets one     |
| `HttpClient.fetch`     | `timeout` | 30 s on the server (`httpClientOptions.timeout`) |
| A repository statement | `timeout` | `DATABASE_TIMEOUT`: 5 s on serverless, else off  |
| `$job`                 | `timeout` | none                                             |

Every one takes a `DurationLike` (`5000`, `[30, "seconds"]`), and `false` opts
out of a default. The option on the call wins over the default.

```typescript check
import { $inject } from "alepha";
import { $action, HttpClient } from "alepha/server";

class Reports {
  protected readonly http = $inject(HttpClient);

  build = $action({
    method: "POST",
    path: "/reports",
    // The middlewares and the handler, at most 10 seconds.
    timeout: [10, "seconds"],
    handler: async () => {
      // A slow third party gets 5 seconds of those.
      const { data } = await this.http.fetch("https://rates.example.com", {
        timeout: [5, "seconds"],
      });
      return JSON.stringify(data);
    },
  });

  exportAll = $action({
    method: "POST",
    path: "/exports",
    // Legitimately long: out of an app-wide default.
    timeout: false,
    handler: async () => "started",
  });
}
```

### What the caller receives

- **An HTTP client** of a timed-out action receives a 503 named `TIMEOUT`,
  `{ "name": "TIMEOUT", "message": "Timed out after 10 s", "data": { "status": 503, "timeout": 10000 } }`.
  A query that timed out answers 503 too, as `DbTimeoutError`, so a client
  sees one status for "did not answer in time, retry". OpenAPI documents the
  503 on every action with a timeout, and strict mode (`errors`) lets it
  through.
- **A model** calling a timed-out `$tool` receives a Tool Execution Error
  (`isError: true`, "Error: Timed out after 30 s"), not a protocol error, so it
  can retry or narrow its request.
- **A job** run that timed out is a failure recorded with its
  `TimeoutError`, retried like any other, never `cancelled`.
- **Code** calling `fetch` or a repository gets the `TimeoutError` (or the
  `DbTimeoutError` carrying it as `cause`).

A timeout is a failure, not an outcome: `isAbortError` answers `false` for a
`TimeoutError`, and it is logged and reported like any other error. Tell the
two apart with `signal.reason instanceof TimeoutError`.

### The outbound default

A server-side `HttpClient.fetch` has a 30 second timeout unless the call or
the `httpClientOptions` atom says otherwise. It covers the headers and the
body. It does not apply to `fetchAction` (a call to an action of the app,
through `$remote` or a link, which its own server bounds) nor in the browser,
where cutting a long action client-side would leave the server working on it.

```typescript check
import { Alepha } from "alepha";
import { httpClientOptions } from "alepha/server";

const alepha = Alepha.create();
// Every server-side fetch: one minute. `false` turns the default off.
alepha.store.mut(httpClientOptions, () => ({ timeout: 60_000 }));
```

### Queries

`DATABASE_TIMEOUT` (milliseconds, `0` disables) is the default timeout of every
repository statement, on every driver, and `DATABASE_TIMEOUT_SCOPE=reads`
limits it to reads. A statement inside a transaction has none: a transaction
is never cut short. A write's timeout never makes it inherit the request's
signal: a write still runs to the end when its client leaves.

```typescript
const rows = await users.findMany(
  { where: { active: { eq: true } } },
  { timeout: [2, "seconds"] },
);
```

What a timeout stops depends on the driver:

| Driver                   | A timed-out statement                                     |
| ------------------------ | --------------------------------------------------------- |
| PostgreSQL (postgres.js) | is cancelled on the server                                |
| Cloudflare D1            | is abandoned: D1 cannot abort, it finishes on its own     |
| SQLite (Node, Bun)       | runs to completion if it started: SQLite is synchronous   |
| PGlite, `Bun.sql`        | runs to completion if it started; refused if not yet sent |

Except under SQLite, whose running statement holds the whole process, the
caller is released at the deadline. Postgres
`statement_timeout` is not used: the client-side cancel already stops the
statement, without a round trip per query.

## In the browser

There is no async context in the browser. `alepha.context.signal` is the app
signal, and `withSignal` and `detachSignal` simply call their function.
Cancellation there stays explicit, where it already lives: `useAction`,
`useQuery` and the query cache abort what they started.
