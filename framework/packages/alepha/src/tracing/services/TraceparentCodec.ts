import type { TraceContext } from "../interfaces/SpanTypes.ts";

/**
 * W3C Trace Context `traceparent`: `00-<trace id>-<span id>-<flags>`.
 *
 * Parsed at every entry point that continues a trace (a request, a queue or
 * topic message) and formatted by every exit that propagates one
 * (`HttpClient`, a queue or topic producer).
 *
 * @see https://www.w3.org/TR/trace-context/#traceparent-header
 */
export class TraceparentCodec {
  protected readonly pattern =
    /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(?:-.*)?$/;

  /**
   * The span context `header` carries, or `undefined` when it is absent or
   * invalid: a bad header starts a new trace rather than failing the work.
   *
   * Version `ff` is invalid, as are all-zero ids. A version above `00` is
   * read as `00` (the spec's forward-compatibility rule), with extra fields
   * ignored; version `00` itself must be exactly four fields.
   */
  public parse(header: string | null | undefined): TraceContext | undefined {
    if (!header || typeof header !== "string" || header.length > 512) {
      return undefined;
    }
    const value = header.trim().toLowerCase();
    const match = this.pattern.exec(value);
    if (!match) {
      return undefined;
    }
    const [, version, traceId, spanId, flags] = match;
    if (version === "ff") {
      return undefined;
    }
    if (version === "00" && value.length !== 55) {
      return undefined;
    }
    if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) {
      return undefined;
    }
    return {
      traceId,
      spanId,
      sampled: (Number.parseInt(flags, 16) & 1) === 1,
    };
  }

  /**
   * The `traceparent` value for a span context.
   */
  public format(context: TraceContext): string {
    return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
  }

  /**
   * A fresh random 16-byte trace id, as 32 lowercase hex characters.
   */
  public newTraceId(): string {
    return this.randomHex(16);
  }

  /**
   * A fresh random 8-byte span id, as 16 lowercase hex characters.
   */
  public newSpanId(): string {
    return this.randomHex(8);
  }

  protected randomHex(bytes: number): string {
    const buffer = crypto.getRandomValues(new Uint8Array(bytes));
    let out = "";
    for (let i = 0; i < buffer.length; i++) {
      out += buffer[i].toString(16).padStart(2, "0");
    }
    // An all-zero id is invalid; at these sizes it never happens, but a
    // header built from one would be dropped by the next hop.
    return /^0+$/.test(out) ? this.randomHex(bytes) : out;
  }
}
