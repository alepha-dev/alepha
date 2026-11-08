import { $inject } from "alepha";

import type { SpanSink } from "../interfaces/SpanSink.ts";
import type { Span } from "../services/Span.ts";
import { Tracer } from "../services/Tracer.ts";

/**
 * A recent trace, as {@link MemoryTraceProvider.traces} lists it.
 */
export interface TraceSummary {
  traceId: string;
  /**
   * The root span's name: the span of the trace with no parent recorded
   * here (a continued trace's root has a parent in another process).
   */
  name: string;
  startTime: number;
  /**
   * Milliseconds from the first span's start to the last span's end.
   */
  duration: number;
  status: "unset" | "ok" | "error";
  spanCount: number;
}

/**
 * Keeps finished spans in memory, grouped by trace, for devtools and specs.
 *
 * A bounded ring: the last {@link maxTraces} traces (200), each capped at
 * {@link maxSpansPerTrace} spans (1000), the oldest trace dropped first.
 * Never unbounded. Registering it (injecting it) turns recording on and
 * forces sampling to 1.
 *
 * ```ts
 * const alepha = Alepha.create();
 * const traces = alepha.inject(MemoryTraceProvider);
 * await alepha.start();
 * // ... exercise the app
 * expect(traces.spans().map((s) => s.name)).toContain("GET /users");
 * ```
 */
export class MemoryTraceProvider implements SpanSink {
  protected readonly tracer = $inject(Tracer);

  public readonly forceSampling = true;

  public maxTraces = 200;
  public maxSpansPerTrace = 1000;

  /**
   * Spans by trace id, in the order each trace was first seen: a `Map`
   * iterates in insertion order, which is what makes the oldest the first.
   */
  protected readonly store = new Map<string, Span[]>();

  constructor() {
    this.tracer.addSink(this);
  }

  public onEnd(span: Span): void {
    let spans = this.store.get(span.traceId);
    if (!spans) {
      spans = [];
      this.store.set(span.traceId, spans);
      while (this.store.size > this.maxTraces) {
        const oldest = this.store.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.store.delete(oldest);
      }
    }
    if (spans.length < this.maxSpansPerTrace) {
      spans.push(span);
    }
  }

  /**
   * Every recorded span, oldest trace first.
   */
  public spans(): Span[] {
    const out: Span[] = [];
    for (const spans of this.store.values()) {
      out.push(...spans);
    }
    return out;
  }

  /**
   * The spans of one trace, in the order they started, or an empty array.
   */
  public trace(traceId: string): Span[] {
    return [...(this.store.get(traceId) ?? [])].sort(
      (a, b) => a.startTime - b.startTime,
    );
  }

  /**
   * The recorded traces, most recent first.
   */
  public traces(): TraceSummary[] {
    const out: TraceSummary[] = [];
    for (const [traceId, spans] of this.store) {
      out.push(this.summarize(traceId, spans));
    }
    return out.toReversed();
  }

  /**
   * The first recorded span named `name`, for a spec.
   */
  public find(name: string): Span | undefined {
    for (const spans of this.store.values()) {
      for (const span of spans) {
        if (span.name === name) {
          return span;
        }
      }
    }
    return undefined;
  }

  /**
   * The direct children of `span` among the recorded spans.
   */
  public children(span: Span): Span[] {
    return this.trace(span.traceId).filter(
      (it) => it.parentSpanId === span.spanId,
    );
  }

  public clear(): void {
    this.store.clear();
  }

  protected summarize(traceId: string, spans: Span[]): TraceSummary {
    const ids = new Set(spans.map((span) => span.spanId));
    let root: Span | undefined;
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    let status: TraceSummary["status"] = "unset";
    for (const span of spans) {
      start = Math.min(start, span.startTime);
      end = Math.max(end, span.endTime ?? span.startTime);
      if (span.status === "error") {
        status = "error";
      }
      if (!span.parentSpanId || !ids.has(span.parentSpanId)) {
        if (!root || span.startTime < root.startTime) {
          root = span;
        }
      }
    }
    return {
      traceId,
      name: root?.name ?? "",
      startTime: start,
      duration: Math.max(0, end - start),
      status,
      spanCount: spans.length,
    };
  }
}
