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
   */
  public abstract push(queue: string, message: string): Promise<void>;

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
   */
  public async pushMany(queue: string, messages: string[]): Promise<void> {
    await Promise.all(messages.map((message) => this.push(queue, message)));
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
