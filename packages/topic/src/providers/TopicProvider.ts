import { NotImplementedError } from "@alepha/core";

export class TopicProvider {
	constructor() {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Publish a message to a topic.
	 *
	 * @param topic - The topic to publish to.
	 * @param message - The message to publish.
	 */
	public async publish(_topic: string, _message: string): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Subscribe to a topic.
	 *
	 * @param topic - The topic to subscribe to.
	 * @param callback - The callback to call when a message is received.
	 */
	public async subscribe(
		_topic: string,
		_callback: SubscribeCallback,
	): Promise<UnSubscribeFn> {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Unsubscribe from a topic.
	 *
	 * @param topic - The topic to unsubscribe from.
	 */
	public async unsubscribe(_topic: string): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}
}

export type SubscribeCallback = (message: string) => Promise<void> | void;

export type UnSubscribeFn = () => Promise<void>;
