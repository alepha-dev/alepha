import { $module } from "alepha";

import { MemoryTraceProvider } from "./providers/MemoryTraceProvider.ts";
import { OtlpTraceExporter } from "./providers/OtlpTraceExporter.ts";
import { TraceparentCodec } from "./services/TraceparentCodec.ts";
import { Tracer } from "./services/Tracer.ts";

// ---------------------------------------------------------------------------------------------------------------------

export type * from "./interfaces/SpanSink.ts";
export type * from "./interfaces/SpanTypes.ts";
export * from "./providers/MemoryTraceProvider.ts";
export * from "./providers/OtlpTraceExporter.ts";
export * from "./services/Span.ts";
export * from "./services/TraceparentCodec.ts";
export * from "./services/Tracer.ts";
export * from "./services/WorkerdTracer.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Spans around units of work, nested through the async context.
 *
 * **Features:**
 * - `Tracer.span(name, fn)`: a child of the active span, ended when `fn`
 *   settles, the error recorded and rethrown
 * - The active span lives in the async context, so a child finds its parent
 *   with no argument and concurrent work stays apart
 * - W3C `traceparent` parse and format, with the sampled flag
 * - Sampling decided once at the root, from `TRACING_SAMPLE_RATIO`
 * - Log entries carry `traceId` and `spanId` while a span is active
 * - Sinks: an in-memory ring of recent traces for devtools and specs, and
 *   an OTLP/HTTP JSON exporter on Node and Bun (`OTEL_EXPORTER_OTLP_ENDPOINT`)
 *
 * With no sink registered, nothing is recorded: `span()` calls its callback
 * directly.
 *
 * @module alepha.tracing
 */
export const AlephaTracing = $module({
  name: "alepha.tracing",
  services: [Tracer, TraceparentCodec, OtlpTraceExporter],
  // Injected on demand only: injecting it turns recording on.
  variants: [MemoryTraceProvider],
});
