/**
 * The role of a span in a trace, as OpenTelemetry names it.
 *
 * - `internal`: work inside the process (an action, a query, a manual span).
 * - `server`: an incoming request.
 * - `client`: an outgoing call.
 * - `producer`: a message sent to a queue or a topic.
 * - `consumer`: a message received from one.
 */
export type SpanKind =
  | "internal"
  | "server"
  | "client"
  | "producer"
  | "consumer";

/**
 * `unset` is the default and means "nothing went wrong that this span
 * knows of". `error` is set by a thrown error or by the instrumentation (a
 * 5xx response).
 */
export type SpanStatus = "unset" | "ok" | "error";

/**
 * Attribute values, as OpenTelemetry allows them. Never a bound SQL value, a
 * raw URL, a header or a cache key: attributes leave the process.
 */
export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Record<string, SpanAttributeValue>;

/**
 * A reference to a span of another trace: how a consumer's root points back
 * at the producer that sent the message, without being its child.
 */
export interface SpanLink {
  traceId: string;
  spanId: string;
}

/**
 * The span context a `traceparent` header carries.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

export interface SpanOptions {
  /**
   * Defaults to `internal`.
   */
  kind?: SpanKind;
  attributes?: SpanAttributes;
  links?: SpanLink[];
  /**
   * The callback's return does not end the span: the caller ends it with
   * `span.end()`. For a request root, which ends when the response body has
   * been sent, after the handler returned.
   */
  manualEnd?: boolean;
}

export interface RootSpanOptions extends SpanOptions {
  /**
   * An incoming W3C `traceparent` header. A valid one makes this root a
   * child of the caller's span, in the caller's trace; an invalid or absent
   * one starts a new trace.
   */
  traceparent?: string;
  /**
   * `traceparent` headers of the spans this work came from, recorded as
   * links: a queue or topic message points back at its producer.
   */
  linkTo?: Array<string | undefined>;
}
