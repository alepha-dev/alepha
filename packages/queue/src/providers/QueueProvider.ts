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
	 * Pop a message from the queue.
	 *
	 * @param queue Name of the queue to pop the message from.
	 *
	 * @returns The message popped or `undefined` if the queue is empty.
	 */
	public abstract pop(queue: string): Promise<string | undefined>;
}
