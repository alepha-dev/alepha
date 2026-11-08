import { $module } from "alepha";

import { MemoryTraceProvider } from "./providers/MemoryTraceProvider.ts";
import { TraceparentCodec } from "./services/TraceparentCodec.ts";
import { Tracer } from "./services/Tracer.ts";
import { WorkerdTracer } from "./services/WorkerdTracer.ts";

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
 * The workerd half of `alepha.tracing`: the tracer is {@link WorkerdTracer},
 * whose spans are Cloudflare custom spans, and there is no OTLP exporter
 * (Cloudflare's own destinations export the trace).
 *
 * It imports nothing from `cloudflare:workers`: a barrel must load under the
 * `workerd` condition outside a Worker too. The generated Worker entry hands
 * `tracing` to the container instead (`cloudflare.tracing`). Keep its exports in step
 * with `index.ts` by hand: split-condition barrels are not checked.
 */
export const AlephaTracing = $module({
  name: "alepha.tracing",
  services: [Tracer, TraceparentCodec],
  variants: [MemoryTraceProvider, WorkerdTracer],
  register: (alepha) =>
    alepha.with({ optional: true, provide: Tracer, use: WorkerdTracer }),
});
