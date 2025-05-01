import { NotImplementedError } from "@alepha/core";

export class TopicProvider {
	/**
	 * Publish a message to a topic.
	 *
	 * @param topic - The topic to publish to.
	 * @param message - The message to publish.
	 */
	public async publish(topic: string, message: string): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Subscribe to a topic.
	 *
	 * @param topic - The topic to subscribe to.
	 * @param callback - The callback to call when a message is received.
	 */
	public async subscribe(
		topic: string,
		callback: SubscribeCallback,
	): Promise<UnSubscribeFn> {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Unsubscribe from a topic.
	 *
	 * @param topic - The topic to unsubscribe from.
	 */
	public async unsubscribe(topic: string): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}
}

export type SubscribeCallback = (message: string) => Promise<void> | void;

export type UnSubscribeFn = () => Promise<void>;
