import { NotImplementedError } from "@alepha/core";

export class QueueProvider {
	constructor() {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Push a message to the queue.
	 *
	 * @param queue - The queue name.
	 * @param message - The message to push.
	 */
	public async push(_queue: string, _message: string): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Pop a message from the queue.
	 *
	 * @param queue - The queue name.
	 * @returns The message popped.
	 */
	public async pop(_queue: string): Promise<string | undefined> {
		throw new NotImplementedError(this.constructor.name);
	}
}
