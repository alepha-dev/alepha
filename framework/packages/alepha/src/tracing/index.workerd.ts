import { $module } from "alepha";
import * as workers from "cloudflare:workers";

import { MemoryTraceProvider } from "./providers/MemoryTraceProvider.ts";
import { TraceparentCodec } from "./services/TraceparentCodec.ts";
import { Tracer } from "./services/Tracer.ts";
import {
  type CloudflareTracing,
  WorkerdTracer,
} from "./services/WorkerdTracer.ts";

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

// A namespace read, not a named import: on a compatibility date that predates
// `tracing`, a named import would refuse the whole Worker at link time.
WorkerdTracer.platformTracing = (
  workers as unknown as { tracing?: CloudflareTracing }
).tracing;

/**
 * The workerd half of `alepha.tracing`: the tracer is {@link WorkerdTracer},
 * whose spans are Cloudflare custom spans, and there is no OTLP exporter
 * (Cloudflare's own destinations export the trace). Keep its exports in step
 * with `index.ts` by hand: split-condition barrels are not checked.
 */
export const AlephaTracing = $module({
  name: "alepha.tracing",
  services: [Tracer, TraceparentCodec],
  variants: [MemoryTraceProvider, WorkerdTracer],
  register: (alepha) =>
    alepha.with({ optional: true, provide: Tracer, use: WorkerdTracer }),
});
