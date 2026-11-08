import type { Span } from "../services/Span.ts";

/**
 * Where finished spans go: the memory ring that serves devtools and specs,
 * the OTLP exporter on Node and Bun.
 *
 * A sink is registered on the {@link Tracer} with `addSink()`. While none is
 * registered, the tracer records nothing at all: `span()` calls its callback
 * directly.
 */
export interface SpanSink {
  /**
   * Called once per recorded span, when it ends. Must not throw and must not
   * block: an exporter queues, it never awaits here.
   */
  onEnd(span: Span): void;

  /**
   * Record every trace, whatever `TRACING_SAMPLE_RATIO` says. The memory sink
   * sets it: a spec or a devtools session that sampled half its requests
   * would show half a picture.
   */
  readonly forceSampling?: boolean;
}
