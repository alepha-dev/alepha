import { $logger } from "@alepha/core";
import type { QueueProvider } from "./QueueProvider";

export class MemoryQueueProvider implements QueueProvider {
	/**
	 * The in-memory queue list.
	 */
	protected queueList: Record<string, string[]> = {};

	protected readonly log = $logger();

	/**
	 * Push a message to a queue.
	 * The message is added to the end of the queue.
	 * The queue is created if it does not exist.
	 *
	 * @param queue - The queue to push to.
	 * @param messages The messages to push.
	 */

	public async push(queue: string, ...messages: string[]): Promise<void> {
		if (this.queueList[queue] == null) {
			this.queueList[queue] = [];
		}

		this.queueList[queue].push(...messages);
	}

	/**
	 * Pop a message from a queue.
	 * The message is removed from the queue.
	 * If the queue is empty, this method will return undefined.
	 *
	 * @param queue - The queue to pop from.
	 * @returns The message that was popped from the queue.
	 */

	public async pop(queue: string): Promise<string | undefined> {
		return this.queueList[queue]?.shift();
	}
}
