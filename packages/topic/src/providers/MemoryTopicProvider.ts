import type {
	SubscribeCallback,
	TopicProvider,
	UnSubscribeFn,
} from "./TopicProvider.ts";

export class MemoryTopicProvider implements TopicProvider {
	protected readonly subscriptions: Record<string, SubscribeCallback[]> = {};

	/**
	 * Publish a message to a topic.
	 *
	 * @param topic
	 * @param message
	 */
	public async publish(topic: string, message: string): Promise<void> {
		if (!this.subscriptions[topic]) {
			return;
		}

		for (const callback of this.subscriptions[topic]) {
			await callback(message);
		}
	}

	/**
	 * Subscribe to a topic.
	 *
	 * @param topic - The topic to subscribe to.
	 * @param callback
	 */

	public async subscribe(
		topic: string,
		callback: SubscribeCallback,
	): Promise<UnSubscribeFn> {
		if (!this.subscriptions[topic]) {
			this.subscriptions[topic] = [];
		}

		this.subscriptions[topic].push(callback);

		return async () => {
			const callbacks = this.subscriptions[topic];
			if (!callbacks) {
				return;
			}

			this.subscriptions[topic] = callbacks.filter((cb) => cb !== callback);
			if (this.subscriptions[topic].length === 0) {
				delete this.subscriptions[topic];
			}
		};
	}

	/**
	 * Unsubscribe from a topic.
	 *
	 * @param topic - The topic to unsubscribe from.
	 */
	public async unsubscribe(topic: string): Promise<void> {
		delete this.subscriptions[topic];
	}
}
