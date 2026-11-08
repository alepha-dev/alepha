import { $env, $inject, Alepha, type Infer, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { SpanSink } from "../interfaces/SpanSink.ts";
import type {
  RootSpanOptions,
  SpanAttributes,
  SpanAttributeValue,
  SpanLink,
  SpanOptions,
  TraceContext,
} from "../interfaces/SpanTypes.ts";
import { Span } from "./Span.ts";
import { TraceparentCodec } from "./TraceparentCodec.ts";

const envSchema = z.object({
  TRACING_SAMPLE_RATIO: z
    .number()
    .meta({ min: 0, max: 1, secret: false })
    .describe(
      "Share of new traces recorded, from 0 to 1. Decided once at the root; a continued trace follows the sampled flag of its traceparent. Forced to 1 while the memory sink is on (dev, specs).",
    )
    .default(1),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
}

/**
 * Opens spans around units of work and hands finished ones to the sinks.
 *
 * The active span lives in the ALS context under {@link Tracer.key}: a span
 * opened inside another finds its parent with no argument, and two
 * concurrent callers each see their own. Each span runs its callback in an
 * overlay layer that holds the span only (`alepha.context.overlay()`), so the
 * parent is current again when the callback settles, and nothing the
 * callback writes moves.
 *
 * With no sink registered, nothing is recorded and {@link span} calls its
 * callback directly.
 *
 * ```ts
 * class Checkout {
 *   protected readonly tracer = $inject(Tracer);
 *
 *   async pay(order: Order) {
 *     return this.tracer.span("checkout pay", async (span) => {
 *       span.setAttribute("order.items", order.items.length);
 *       return this.payments.capture(order);
 *     });
 *   }
 * }
 * ```
 */
export class Tracer {
  /**
   * The ALS key holding the active {@link Span}. `alepha/logger` reads it by
   * this string, so it does not import the tracer.
   */
  public static readonly key = "alepha.tracing.span";

  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly codec = $inject(TraceparentCodec);
  protected readonly env = $env(envSchema);

  protected readonly sinks: SpanSink[] = [];

  /**
   * Bound once: every span holds it, and a fresh closure per span is an
   * allocation the hot path does not need.
   */
  protected readonly onSpanEnd = (span: Span): void => this.dispatch(span);
  protected readonly clock = (): number => this.dateTime.nowMillis();

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Register a sink. Recording starts with the first one.
   */
  public addSink(sink: SpanSink): void {
    if (!this.sinks.includes(sink)) {
      this.sinks.push(sink);
    }
  }

  public removeSink(sink: SpanSink): void {
    const index = this.sinks.indexOf(sink);
    if (index !== -1) {
      this.sinks.splice(index, 1);
    }
  }

  /**
   * Whether any sink is registered, so spans are recorded at all.
   */
  public get recording(): boolean {
    return this.sinks.length > 0;
  }

  /**
   * The share of new traces recorded: `TRACING_SAMPLE_RATIO`, or 1 while a
   * sink forces sampling.
   */
  public get sampleRatio(): number {
    if (this.forcesSampling()) {
      return 1;
    }
    const ratio = Number(this.env.TRACING_SAMPLE_RATIO ?? 1);
    return Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The active span, or `undefined` outside any trace.
   */
  public current(): Span | undefined {
    return this.alepha.context.get<Span>(Tracer.key);
  }

  /**
   * Set an attribute on the active span, if there is one.
   */
  public setAttribute(
    key: string,
    value: SpanAttributeValue | undefined,
  ): void {
    this.current()?.setAttribute(key, value);
  }

  /**
   * The `traceparent` header to send on an outgoing call or message, or
   * `undefined` outside any trace.
   */
  public traceparent(): string | undefined {
    const span = this.current();
    if (!span) {
      return undefined;
    }
    return this.codec.format(span);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Run `fn` inside a child span of the active one, named `name`.
   *
   * `fn` may be sync or async. The span ends when it returns or settles; a
   * throw or a rejection records the error on the span and is rethrown. An
   * abort (client disconnect, app stop) ends the span without marking it
   * failed.
   *
   * Outside any trace, the span is the root of a new one.
   */
  public span<R>(
    name: string,
    fn: (span: Span) => R,
    attributes?: SpanAttributes,
  ): R {
    if (!this.recording) {
      return fn(Span.noop);
    }
    return this.startSpan(name, attributes ? { attributes } : {}, fn);
  }

  /**
   * {@link span}, with every option: the kind, links, and `manualEnd` for a
   * span that outlives its callback.
   */
  public startSpan<R>(
    name: string,
    options: SpanOptions,
    fn: (span: Span) => R,
  ): R {
    if (!this.recording) {
      return fn(Span.noop);
    }
    const parent = this.current();
    if (!parent) {
      return options.requireParent
        ? fn(Span.noop)
        : this.startRoot(name, options, fn);
    }
    if (!parent.sampled) {
      return fn(Span.noop);
    }
    const span = this.createSpan(name, options, {
      traceId: parent.traceId,
      parentSpanId: parent.spanId,
      sampled: true,
    });
    return this.runInSpan(span, options, fn);
  }

  /**
   * Open the root span of a unit of work: a request, a job run, a message.
   * Called by each entry point inside the context it opens.
   *
   * A valid incoming `traceparent` continues the caller's trace, with its
   * sampled flag; otherwise a new trace starts, sampled by
   * `TRACING_SAMPLE_RATIO`. With no sink, a continued trace still keeps its
   * ids (unrecorded), so outgoing calls carry the caller's trace on.
   */
  public startRoot<R>(
    name: string,
    options: RootSpanOptions,
    fn: (span: Span) => R,
  ): R {
    const incoming = this.codec.parse(options.traceparent);
    const recording = this.recording;

    if (!recording && !incoming) {
      return fn(Span.noop);
    }

    // A forcing sink (memory: dev, specs) records every trace. Otherwise a
    // continued trace follows its caller's decision, and a new one is
    // sampled here, once, for the whole trace.
    const sampled = !recording
      ? (incoming?.sampled ?? false)
      : this.forcesSampling()
        ? true
        : incoming
          ? incoming.sampled
          : this.sample();

    const span = this.createSpan(
      name,
      { ...options, links: this.linksOf(options) },
      {
        traceId: incoming?.traceId ?? this.codec.newTraceId(),
        parentSpanId: incoming?.spanId,
        sampled,
      },
    );
    return this.runInSpan(span, options, fn);
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected forcesSampling(): boolean {
    for (const sink of this.sinks) {
      if (sink.forceSampling) {
        return true;
      }
    }
    return false;
  }

  protected sample(): boolean {
    const ratio = this.sampleRatio;
    return ratio >= 1 ? true : ratio <= 0 ? false : Math.random() < ratio;
  }

  protected linksOf(options: RootSpanOptions): SpanLink[] | undefined {
    if (!options.linkTo?.length) {
      return options.links;
    }
    const links: SpanLink[] = [...(options.links ?? [])];
    for (const header of options.linkTo) {
      const context = this.codec.parse(header);
      if (context) {
        links.push({ traceId: context.traceId, spanId: context.spanId });
      }
    }
    return links;
  }

  protected createSpan(
    name: string,
    options: SpanOptions,
    context: Omit<TraceContext, "spanId"> & { parentSpanId?: string },
  ): Span {
    const recording = context.sampled && this.recording;
    return new Span({
      traceId: context.traceId,
      spanId: this.codec.newSpanId(),
      parentSpanId: context.parentSpanId,
      name,
      kind: options.kind ?? "internal",
      startTime: this.clock(),
      sampled: context.sampled,
      recording,
      attributes: options.attributes,
      links: options.links,
      onEnd: this.onSpanEnd,
      clock: this.clock,
    });
  }

  /**
   * Run `fn` with `span` as the active span, and end the span when `fn`
   * settles (unless `manualEnd`).
   *
   * The span lives in an overlay layer (`alepha.context.overlay()`): writes
   * inside `fn` still land where they would without tracing, so a traced
   * page loader that sets an atom keeps it for the render.
   *
   * The one place a span becomes current: a runtime adapter that must also
   * open a platform span (Cloudflare's tracer on workerd) overrides it.
   */
  protected runInSpan<R>(
    span: Span,
    options: SpanOptions,
    fn: (span: Span) => R,
  ): R {
    return this.alepha.context.overlay(Tracer.key, span, () =>
      this.settle(span, options, fn),
    );
  }

  /**
   * Call `fn`, then end `span` on return, throw, resolve or reject. A throw
   * or a rejection is recorded and rethrown, unchanged.
   */
  protected settle<R>(
    span: Span,
    options: SpanOptions,
    fn: (span: Span) => R,
  ): R {
    let result: R;
    try {
      result = fn(span);
    } catch (error) {
      this.fail(span, error);
      span.end();
      throw error;
    }

    if (
      result !== null &&
      typeof result === "object" &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      return (result as unknown as Promise<unknown>).then(
        (value) => {
          if (!options.manualEnd) {
            span.end();
          }
          return value;
        },
        (error: unknown) => {
          this.fail(span, error);
          span.end();
          throw error;
        },
      ) as R;
    }

    if (!options.manualEnd) {
      span.end();
    }
    return result;
  }

  /**
   * Record `error` on `span`, unless it is an abort: a client that left or a
   * stopping app is not a failure of the work.
   */
  public fail(span: Span, error: unknown): void {
    if (!span.recording) {
      return;
    }
    if (this.alepha.context.isAbortError(error)) {
      span.setAttribute("alepha.aborted", true);
      return;
    }
    span.recordException(error);
  }

  protected dispatch(span: Span): void {
    if (!span.recording) {
      return;
    }
    for (const sink of this.sinks) {
      try {
        sink.onEnd(span);
      } catch {
        // A sink must never break the traced work.
      }
    }
  }
}
