# Alepha - Tracing

## Installation

Part of the `alepha` package. Import from `alepha/tracing`.

```bash
npm install alepha
```

## Overview

Spans around units of work, nested through the async context.

**Features:**

- `Tracer.span(name, fn)`: a child of the active span, ended when `fn`
  settles, the error recorded and rethrown
- The active span lives in the async context, so a child finds its parent
  with no argument and concurrent work stays apart
- W3C `traceparent` parse and format, with the sampled flag
- Sampling decided once at the root, from `TRACING_SAMPLE_RATIO`
- Log entries carry `traceId` and `spanId` while a span is active
- Sinks: an in-memory ring of recent traces for devtools and specs

With no sink registered, nothing is recorded: `span()` calls its callback
directly.

## API Reference

### Providers

- [`MemoryTraceProvider`](/docs/reference-providers-memorytraceprovider) - Keeps finished spans in memory, grouped by trace, for devtools and specs.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable               | Type   | Default | Description                                                                                                                                                                               |
| ---------------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRACING_SAMPLE_RATIO` | number | 1       | Share of new traces recorded, from 0 to 1. Decided once at the root; a continued trace follows the sampled flag of its traceparent. Forced to 1 while the memory sink is on (dev, specs). |
