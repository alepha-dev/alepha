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

## In the browser

There is no async context in the browser. `alepha.context.signal` is the app
signal, and `withSignal` and `detachSignal` simply call their function.
Cancellation there stays explicit, where it already lives: `useAction`,
`useQuery` and the query cache abort what they started.

Timeouts build on this signal and are covered by their own guide.
