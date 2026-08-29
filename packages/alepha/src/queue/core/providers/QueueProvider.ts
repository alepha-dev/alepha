import { AlephaError } from "alepha";

/**
 * Per-send options.
 */
export interface QueuePushOptions {
  /**
   * Do not deliver this message before `delaySeconds` from now.
   *
   * > `delaySeconds` is an optimisation. The outbox row's `scheduledAt` is
   * > the truth, and the sweep is the backstop. A backend that cannot honour
   * > a delay must **decline to enqueue** rather than enqueue immediately.
   *
   * That rule is what lets backends at three different capability levels
   * share one interface with no `supports()` check anywhere in `$job`.
   *
   * It is also the easiest thing to get wrong here, so it is worth spelling
   * out why "ignore the delay" is not a graceful degradation. For a push
   * transport, ignoring a delay means **delivering now**. For a retry that
   * is strictly worse than doing nothing: nothing means the sweep picks the
   * row up on its next tick, while delivering now means zero backoff against
   * a downstream that has just failed.
   *
   * Decline by throwing {@link QueueDelayNotSupportedError}. A `Promise<void>`
   * that resolves says the message was accepted, which would be a lie.
   */
  delaySeconds?: number;
}

/**
 * Thrown by a backend asked for a delay it cannot honour.
 *
 * Not a failure: the caller is expected to catch it and fall back to
 * whatever it has (for `$job`, a local promoting timer, and behind that the
 * outbox row's own `scheduledAt` plus the sweep). It exists so that
 * "I did not enqueue this" is impossible to confuse with "I enqueued it".
 */
export class QueueDelayNotSupportedError extends AlephaError {}

/**
 * Minimalist Queue interface.
 *
 * Will be probably enhanced in the future to support more advanced features. But for now, it's enough!
 */
export abstract class QueueProvider {
  /**
   * Push a message to the queue.
   *
   * @param queue Name of the queue to push the message to.
   * @param message String message to be pushed to the queue. Buffer messages are not supported for now.
   * @param options Per-send options. See {@link QueuePushOptions.delaySeconds}
   *   for the rule a backend must follow when it cannot honour a delay.
   */
  public abstract push(
    queue: string,
    message: string,
    options?: QueuePushOptions,
  ): Promise<void>;

  /**
   * Push several messages to the same queue.
   *
   * The default implementation just fans out to {@link push}. Backends with a
   * native batch send (Cloudflare Queues `sendBatch`, Redis pipelines) should
   * override this — on Cloudflare in particular, one `send()` per message
   * burns one subrequest per message against the Worker's quota.
   *
   * @param queue Name of the queue to push the messages to.
   * @param messages String messages to be pushed, in order.
   * @param options Applies to the whole batch.
   */
  public async pushMany(
    queue: string,
    messages: string[],
    options?: QueuePushOptions,
  ): Promise<void> {
    await Promise.all(
      messages.map((message) => this.push(queue, message, options)),
    );
  }

  /**
   * Pop a message from the queue.
   *
   * @param queue Name of the queue to pop the message from.
   *
   * @returns The message popped or `undefined` if the queue is empty.
   */
  public abstract pop(queue: string): Promise<string | undefined>;
}
