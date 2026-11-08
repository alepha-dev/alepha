import type { RootSpanOptions, SpanOptions } from "../interfaces/SpanTypes.ts";
import { Span } from "./Span.ts";
import { Tracer } from "./Tracer.ts";

/**
 * The slice of `cloudflare:workers`' `tracing` this adapter calls. Declared
 * here rather than taken from `@cloudflare/workers-types`, which `alepha`
 * does not depend on.
 */
export interface CloudflareTracing {
  startActiveSpan<T>(name: string, callback: (span: CloudflareSpan) => T): T;
  getActiveSpan(): CloudflareSpan | undefined;
}

export interface CloudflareSpan {
  readonly isTraced?: boolean;
  spanContext(): { traceId: string; spanId: string; traceFlags: number };
  setAttributes(
    attributes: Record<string, boolean | number | string | undefined>,
  ): unknown;
  recordException(exception: { name: string; message?: string }): void;
  updateName(name: string): unknown;
  setStatus(status: {
    code: "unset" | "ok" | "error";
    message?: string;
  }): unknown;
  end(): void;
}

/**
 * The tracer on Cloudflare Workers: every Alepha span is a Cloudflare custom
 * span, so Alepha's spans nest with the ones the platform records itself (D1,
 * KV, R2, Durable Objects, fetch) in one tree, exported through Cloudflare's
 * own OTLP destinations.
 *
 * - A child span opens with `tracing.startActiveSpan()` around the callback:
 *   the callback form is the one that nests. Its ids are Cloudflare's, so
 *   log entries carry the ids Workers Observability shows.
 * - A root does not open a second root: it renames the invocation's span
 *   (`<METHOD> <route pattern>` for a request) and records on it.
 * - Attributes, the error and the status are written onto the Cloudflare
 *   span when the Alepha span ends.
 * - With traces off for the Worker, Cloudflare's ids are all zeros: nothing
 *   is recorded on its side, and no log line gets an id.
 * - No `traceparent` leaves a Worker: Cloudflare does not say whether a
 *   request is sampled, and its ids are not propagated outside it.
 */
export class WorkerdTracer extends Tracer {
  /**
   * `cloudflare:workers`' `tracing`, set by the workerd barrel. Absent on
   * a compatibility date that predates it.
   */
  public static platformTracing?: CloudflareTracing;

  protected platform(): CloudflareTracing | undefined {
    return WorkerdTracer.platformTracing;
  }

  /**
   * Recording on Cloudflare's side: the invocation is traced.
   */
  protected platformTraced(): boolean {
    const active = this.platform()?.getActiveSpan();
    return !!active && active.isTraced !== false && !this.isZeroId(active);
  }

  public override get recording(): boolean {
    return super.recording || this.platformTraced();
  }

  public override traceparent(): string | undefined {
    return undefined;
  }

  public override startSpan<R>(
    name: string,
    options: SpanOptions,
    fn: (span: Span) => R,
  ): R {
    const platform = this.platform();
    if (!platform || !this.platformTraced()) {
      return super.startSpan(name, options, fn);
    }
    const parent = this.current();
    if (!parent && options.requireParent) {
      return fn(Span.noop);
    }
    return platform.startActiveSpan(name, (cfSpan) => {
      if (this.isZeroId(cfSpan)) {
        cfSpan.end();
        return super.startSpan(name, options, fn);
      }
      const context = cfSpan.spanContext();
      const span = this.platformSpan(name, options, {
        traceId: context.traceId,
        spanId: context.spanId,
        parentSpanId: parent?.spanId,
        onEnd: (ended) => {
          this.mirror(cfSpan, ended, name);
          cfSpan.end();
          this.dispatch(ended);
        },
      });
      return this.alepha.context.overlay(Tracer.key, span, () =>
        this.settle(span, options, fn),
      );
    });
  }

  public override startRoot<R>(
    name: string,
    options: RootSpanOptions,
    fn: (span: Span) => R,
  ): R {
    const active = this.platform()?.getActiveSpan();
    if (!active || !this.platformTraced()) {
      return super.startRoot(name, options, fn);
    }
    // Inside an Alepha span already (a topic message handled within the
    // request that published it): Cloudflare cannot start a new trace, so
    // the work becomes a child of what is running.
    if (this.current()) {
      return this.startSpan(name, options, fn);
    }

    active.updateName(name);
    const context = active.spanContext();
    const span = this.platformSpan(
      name,
      { ...options, links: this.linksOf(options) },
      {
        traceId: context.traceId,
        spanId: context.spanId,
        // The invocation's span is Cloudflare's to end.
        onEnd: (ended) => {
          this.mirror(active, ended, name);
          this.dispatch(ended);
        },
      },
    );
    return this.alepha.context.overlay(Tracer.key, span, () =>
      this.settle(span, options, fn),
    );
  }

  protected platformSpan(
    name: string,
    options: SpanOptions,
    ids: {
      traceId: string;
      spanId: string;
      parentSpanId?: string;
      onEnd: (span: Span) => void;
    },
  ): Span {
    return new Span({
      traceId: ids.traceId,
      spanId: ids.spanId,
      parentSpanId: ids.parentSpanId,
      name,
      kind: options.kind ?? "internal",
      startTime: this.clock(),
      sampled: true,
      recording: true,
      attributes: options.attributes,
      links: options.links,
      onEnd: ids.onEnd,
      clock: this.clock,
    });
  }

  /**
   * Write what the Alepha span learned onto its Cloudflare span: the
   * attributes, a rename, the error and the status. A link has no place on
   * a Cloudflare span, so the first one is kept as attributes.
   */
  protected mirror(target: CloudflareSpan, span: Span, openedAs: string): void {
    const attributes: Record<string, boolean | number | string> = {
      ...span.attributes,
      "span.kind": span.kind,
    };
    const link = span.links[0];
    if (link) {
      attributes["link.trace_id"] = link.traceId;
      attributes["link.span_id"] = link.spanId;
    }
    target.setAttributes(attributes);
    if (span.name !== openedAs) {
      target.updateName(span.name);
    }
    if (span.exception) {
      target.recordException({
        name: span.exception.type,
        message: span.exception.message,
      });
    }
    if (span.status === "error") {
      target.setStatus({ code: "error", message: span.statusMessage });
    }
  }

  protected isZeroId(span: CloudflareSpan): boolean {
    const { traceId } = span.spanContext();
    return !traceId || /^0+$/.test(traceId);
  }
}
