import { NotImplementedError } from "@alepha/core";

export class QueueProvider {
	/**
	 * Push a message to the queue.
	 *
	 * @param queue - The queue name.
	 * @param message - The message to push.
	 */
	public async push(queue: string, message: string): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Pop a message from the queue.
	 *
	 * @param queue - The queue name.
	 * @returns The message popped.
	 */
	public async pop(queue: string): Promise<string | undefined> {
		throw new NotImplementedError(this.constructor.name);
	}
}
