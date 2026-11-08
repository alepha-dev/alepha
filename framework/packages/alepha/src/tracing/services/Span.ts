import type {
  SpanAttributes,
  SpanAttributeValue,
  SpanKind,
  SpanLink,
  SpanStatus,
} from "../interfaces/SpanTypes.ts";

/**
 * One timed unit of work in a trace.
 *
 * Opened by `Tracer.span()` or `Tracer.startRoot()`, never constructed by app
 * code. A span that is not `recording` (tracing off, or an unsampled trace)
 * still carries its ids, so an outgoing `traceparent` keeps the caller's
 * trace whole, but every setter on it is a no-op.
 */
export class Span {
  /**
   * The span handed to a callback while nothing is recorded. Shared, so the
   * no-op path allocates nothing.
   */
  public static readonly noop: Span = new Span({
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
    name: "",
    kind: "internal",
    startTime: 0,
    sampled: false,
    recording: false,
  });

  public readonly traceId: string;
  public readonly spanId: string;
  public readonly parentSpanId?: string;
  public readonly kind: SpanKind;
  public readonly startTime: number;
  public readonly sampled: boolean;
  public readonly recording: boolean;
  public readonly attributes: SpanAttributes = {};
  public readonly links: SpanLink[];

  public name: string;
  public endTime?: number;
  public status: SpanStatus = "unset";
  public statusMessage?: string;

  /**
   * The error that ended the span, when one did: its type and message only,
   * never its stack (spans leave the process).
   */
  public exception?: { type: string; message: string };

  protected readonly onEnd?: (span: Span) => void;
  protected readonly clock?: () => number;

  constructor(init: {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: SpanKind;
    startTime: number;
    sampled: boolean;
    recording: boolean;
    attributes?: SpanAttributes;
    links?: SpanLink[];
    onEnd?: (span: Span) => void;
    clock?: () => number;
  }) {
    this.traceId = init.traceId;
    this.spanId = init.spanId;
    this.parentSpanId = init.parentSpanId;
    this.name = init.name;
    this.kind = init.kind;
    this.startTime = init.startTime;
    this.sampled = init.sampled;
    this.recording = init.recording;
    this.links = init.links ?? [];
    this.onEnd = init.onEnd;
    this.clock = init.clock;
    if (init.attributes && this.recording) {
      Object.assign(this.attributes, init.attributes);
    }
  }

  /**
   * Whether the span has ended.
   */
  public get ended(): boolean {
    return this.endTime !== undefined;
  }

  /**
   * Milliseconds between start and end, `undefined` while running.
   */
  public get duration(): number | undefined {
    return this.endTime === undefined
      ? undefined
      : this.endTime - this.startTime;
  }

  public setAttribute(
    key: string,
    value: SpanAttributeValue | undefined,
  ): this {
    if (this.recording && value !== undefined) {
      this.attributes[key] = value;
    }
    return this;
  }

  public setAttributes(
    attributes: Record<string, SpanAttributeValue | undefined>,
  ): this {
    if (this.recording) {
      for (const key in attributes) {
        const value = attributes[key];
        if (value !== undefined) {
          this.attributes[key] = value;
        }
      }
    }
    return this;
  }

  public setStatus(status: SpanStatus, message?: string): this {
    if (this.recording) {
      this.status = status;
      this.statusMessage = message;
    }
    return this;
  }

  /**
   * Mark the span failed by `error`. Records the error's name and message,
   * never its stack.
   */
  public recordException(error: unknown): this {
    if (!this.recording) {
      return this;
    }
    const type =
      error instanceof Error
        ? error.name
        : typeof error === "object" && error && "name" in error
          ? String((error as { name: unknown }).name)
          : typeof error;
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";
    this.exception = { type, message };
    this.status = "error";
    this.statusMessage = message || type;
    return this;
  }

  public updateName(name: string): this {
    if (this.recording) {
      this.name = name;
    }
    return this;
  }

  /**
   * End the span. Repeated calls are ignored: the first end wins. For a span
   * opened with `manualEnd`; any other ends when its callback settles.
   */
  public end(): void {
    if (this.endTime !== undefined || !this.clock) {
      return;
    }
    this.endTime = this.clock();
    this.onEnd?.(this);
  }
}
