# OtlpTraceExporter

## Import

```typescript
import { OtlpTraceExporter } from "alepha/tracing";
```

## Overview

Posts finished spans to an OTLP/HTTP receiver as JSON (`/v1/traces`).

On only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, with the standard OTel
variable names, so a backend's own setup guide applies as written. Spans
are batched: a batch leaves when it reaches `maxBatchSize` (512) or
`flushIntervalMs` (5 s) after its first span, and whatever is queued
leaves on `stop`. The queue is bounded (`maxQueueSize`): past it, new
spans are dropped rather than held.

Posted with the global `fetch`, never `HttpClient`: the server module
imports the tracer, and an exporter that went through `HttpClient` would
trace its own posts. A failed export logs once at warn and drops its
batch: it never retries, never blocks a request and never throws into app
code.

Node and Bun only. On Cloudflare Workers spans go to Cloudflare's own
tracer, which exports them itself.
