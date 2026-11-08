import { $inject, Alepha, type Infer, type ZType } from "alepha";
import { Tracer } from "alepha/tracing";

/**
 * Owns the on-the-wire shape of a queue message.
 *
 * Producers ({@link QueueProvider} callers) encode, the worker loop decodes.
 * Keeping both halves here means the envelope has exactly one definition -
 * it used to be split between the `$queue` primitive and `WorkerProvider`,
 * so a change to one side could silently corrupt payloads.
 *
 * The envelope is `{ headers, payload }`. `headers` carries message
 * metadata without a format break: today the producer's `traceparent`, when
 * a span is active, so the consumer's root links back to it. A consumer
 * that predates a header ignores it.
 */
export class QueueCodec {
  protected readonly alepha = $inject(Alepha);
  protected readonly tracer = $inject(Tracer);

  /**
   * Serialize a payload for the backend.
   */
  public encode<T extends ZType>(schema: T, payload: Infer<T>): string {
    const traceparent = this.tracer.traceparent();
    return JSON.stringify({
      headers: traceparent ? { traceparent } : {},
      // Encode on the way out, decode on the way in — the pairing
      // `$topic.publishMessage` already uses. With the current codec the two
      // are identical, so this changes no bytes today; it stops a future
      // encoding change from silently corrupting queue payloads.
      payload: this.alepha.codec.encode(schema, payload),
    });
  }

  /**
   * Parse a message off the backend back into a validated payload.
   *
   * Throws on malformed JSON or a payload that does not match `schema`.
   */
  public decode<T extends ZType>(schema: T, message: string): Infer<T> {
    return this.decodeEnvelope(schema, message).payload;
  }

  /**
   * {@link decode}, with the envelope's headers beside the payload. A
   * message written before headers existed answers `{}`.
   */
  public decodeEnvelope<T extends ZType>(
    schema: T,
    message: string,
  ): { headers: QueueMessageHeaders; payload: Infer<T> } {
    const json = JSON.parse(message);
    const headers =
      json && typeof json.headers === "object" && json.headers !== null
        ? (json.headers as QueueMessageHeaders)
        : {};
    return {
      headers,
      payload: this.alepha.codec.decode(schema, json.payload),
    };
  }
}

/**
 * The metadata a queue message carries beside its payload.
 */
export interface QueueMessageHeaders {
  /**
   * The W3C `traceparent` of the span that produced the message.
   */
  traceparent?: string;
  [key: string]: unknown;
}
