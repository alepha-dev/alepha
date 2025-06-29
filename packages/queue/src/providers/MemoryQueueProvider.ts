import { $logger } from "@alepha/core";
import type { QueueProvider } from "./QueueProvider.ts";

export class MemoryQueueProvider implements QueueProvider {
	protected readonly log = $logger();
	protected queueList: Record<string, string[]> = {};

	public async push(queue: string, ...messages: string[]): Promise<void> {
		if (this.queueList[queue] == null) {
			this.queueList[queue] = [];
		}

		this.queueList[queue].push(...messages);
	}

	public async pop(queue: string): Promise<string | undefined> {
		return this.queueList[queue]?.shift();
	}
}
