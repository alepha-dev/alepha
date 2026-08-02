import { $inject, Alepha, type Infer, type ZType } from "alepha";

/**
 * Owns the on-the-wire shape of a queue message.
 *
 * Producers ({@link QueueProvider} callers) encode, the worker loop decodes.
 * Keeping both halves here means the envelope has exactly one definition —
 * it used to be split between the `$queue` primitive and `WorkerProvider`,
 * so a change to one side could silently corrupt payloads.
 *
 * The envelope is `{ headers, payload }`. `headers` is currently always
 * empty and exists so message metadata can be added without a format break.
 */
export class QueueCodec {
  protected readonly alepha = $inject(Alepha);

  /**
   * Serialize a payload for the backend.
   */
  public encode<T extends ZType>(schema: T, payload: Infer<T>): string {
    return JSON.stringify({
      headers: {},
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
    const json = JSON.parse(message);
    return this.alepha.codec.decode(schema, json.payload);
  }
}
