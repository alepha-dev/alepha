# Tracing

Alepha traces itself. Every request, job run, cron tick and queue or topic
message opens a trace, and the work inside it (actions, page loaders, queries,
outbound calls, cache reads, lock waits) becomes its spans. There is no code to
write: you choose where the spans go.

- **In development**, devtools shows each trace as a waterfall.
- **On Node and Bun**, set `OTEL_EXPORTER_OTLP_ENDPOINT` and spans are posted to
  any OpenTelemetry backend.
- **On Cloudflare Workers**, spans join Cloudflare's own trace, beside the D1,
  KV and fetch spans the platform records.

With none of these, nothing is recorded and tracing costs a length check per
instrumented call.

## What is traced

| Span                         | Opened by                                | Kind     |
| ---------------------------- | ---------------------------------------- | -------- |
| `GET /users/:id`             | a server request, named by route pattern | server   |
| `action createUser`          | each `$action` call, HTTP or local       | internal |
| `loader home`, `render home` | each `$page` loader, and the SSR render  | internal |
| `job sendDigest`             | a `$job` run                             | internal |
| `cron sendDigest`            | a cron tick                              | internal |
| `queue jobs`, `topic orders` | a queue or topic message                 | consumer |
| `GET api.example.com`        | each `HttpClient` call                   | client   |
| `select users`, `insert ...` | each SQL statement a repository runs     | internal |
| `query`                      | a raw `DatabaseProvider.execute()`       | internal |
| `cache get user-profile`     | a `$cache` read, write or invalidate     | internal |
| `lock acquire`               | a `$lock` waiting for its lock           | internal |

A request span ends when the response has been sent, so a streamed page counts
its whole stream. A 5xx marks it failed; a 4xx does not. A thrown error is
recorded on the span it escaped, with its type and message.

One repository method can call another (`getById` reads through `findMany`),
but each statement is one span, named by its SQL verb and table. Five
`select order_items` spans under one parent is the shape of an N+1, and
devtools flags it.

Queries, cache operations and lock waits are only recorded inside a trace: a
statement run at boot or by a poll loop opens no trace of its own.

## Log lines carry their trace

While a span is active, every log entry carries `traceId` and `spanId`. A JSON
log line opens its trace, and devtools shows a span's own log lines under it.

```json
{
  "level": "INFO",
  "message": "Charging card",
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "spanId": "b7ad6b7169203331"
}
```

## Naming a business step

`Tracer.span()` wraps a block of your own code in a span. It nests under
whatever is running, ends when the callback returns or settles, and records
and rethrows an error.

```typescript check
import { $inject } from "alepha";
import { Tracer } from "alepha/tracing";

class Checkout {
  protected readonly tracer = $inject(Tracer);

  async pay(order: { id: string; items: string[] }) {
    return this.tracer.span("checkout pay", async (span) => {
      span.setAttribute("order.items", order.items.length);
      // ... the work
      return order.id;
    });
  }
}
```

Attributes leave the process. Record counts and categories, never personal data,
tokens or ids that identify a person.

## Across services

`HttpClient` sends a W3C `traceparent` header with every call made inside a
trace, and an Alepha server receiving one continues the caller's trace. Two
Alepha services on Node or Bun therefore form a single trace.

A queue or topic message carries the producer's `traceparent` in its envelope.
The consumer starts a trace of its own, **linked** to the producer's span rather
than nested under it: a message can be handled long after the request that sent
it ended.

## Exporting on Node and Bun

Point the OTLP exporter at a collector or a hosted backend. Every mainstream one
accepts OTLP over HTTP directly, so no collector is needed.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=authorization=Basic%20dXNlcjpwYXNz
```

Spans are posted as JSON to `<endpoint>/v1/traces`, in batches of 512 or every
five seconds, and whatever is queued is sent when the app stops. The service
name is the app's name (`APP_NAME`). A failed export is logged once and dropped:
it never retries, never slows a request and never throws into your code.

### Sampling

`TRACING_SAMPLE_RATIO` (from 0 to 1, default 1) is the share of new traces
recorded. It is decided once, at the root, and a trace continued from another
service follows that service's decision. At the volumes most apps see, keep the
default: record everything.

## On Cloudflare Workers

On a Worker, Alepha's spans are Cloudflare custom spans: the request span,
your actions and queries sit in the same tree as the platform's D1, KV, R2,
Durable Object and fetch spans, and log lines carry the ids the dashboard
shows. There is no exporter of Alepha's own; Cloudflare's OTLP destinations
export the whole trace.

Traces are opt in, because Cloudflare bills them as observability ingestion.
Set `TRACING_SAMPLE_RATIO` when you build:

```bash
TRACING_SAMPLE_RATIO=1 alepha build --runtime workerd
```

The build then writes `observability.traces` into `wrangler.jsonc`, with that
ratio as its sampling rate. Without the variable, no traces key is written and
nothing is recorded. An app that declares its own `observability` block keeps it
untouched.

No `traceparent` leaves a Worker: Cloudflare does not say whether a request is
sampled, and its trace ids are not propagated outside Cloudflare.

## Reading traces in devtools

Under `alepha dev`, open devtools and pick **Traces**: the last two hundred
traces of the app, newest first, with a filter for failed ones. A trace opens
as a waterfall; a span shows its timing, attributes, error and log lines. A
parent of five or more same-name spans carries an N+1 warning.

## What is never recorded

- Bound SQL values, the SQL text, or a `where` object.
- A raw URL, a query string or a header: a request span holds the route
  pattern, an `HttpClient` span the host.
- A cache key: a cache span names the cache.
- A computed lock name: `lock.name` is recorded only when the name is a static
  string.

## Time on Workers

On Cloudflare Workers the clock only advances across I/O. A span that only
computes measures 0 ms there, however long it took. Durations of spans that
wait on a query or a fetch are accurate.
