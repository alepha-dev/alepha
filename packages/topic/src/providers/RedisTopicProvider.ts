import { $hook, $inject, $logger, t } from "@alepha/core";
import { RedisProvider, RedisSubscriberProvider } from "@alepha/redis";
import type {
	SubscribeCallback,
	TopicProvider,
	UnSubscribeFn,
} from "./TopicProvider.ts";

const envSchema = t.object({
	REDIS_TOPIC_PREFIX: t.string({
		default: "topic",
	}),
});

export class RedisTopicProvider implements TopicProvider {
	protected readonly env = $inject(envSchema);
	protected readonly redisProvider = $inject(RedisProvider);
	protected readonly redisSubscriberProvider = $inject(RedisSubscriberProvider);
	protected readonly subscriptions: Record<string, SubscribeCallback[]> = {};

	protected readonly log = $logger();

	protected readonly start = $hook({
		name: "start",
		handler: () => {
			this.listen();
		},
	});

	protected readonly stop = $hook({
		name: "stop",
		handler: async () => {
			this.redisSubscriberProvider.subscriber.removeAllListeners();
			for (const topic of Object.keys(this.subscriptions)) {
				for (const callback of this.subscriptions[topic]) {
					await this.unsubscribe(topic, callback);
				}
			}
		},
	});

	public prefix(queue: string): string {
		return `${this.env.REDIS_TOPIC_PREFIX}:${queue}`;
	}

	/**
	 * Publish a message to a topic.
	 *
	 * @param topic
	 * @param message
	 */
	public async publish(topic: string, message: string): Promise<void> {
		await this.redisProvider.publisher.publish(this.prefix(topic), message);
	}

	/**
	 * Subscribe to a topic.
	 *
	 * @param name
	 * @param callback
	 */
	public async subscribe(
		name: string,
		callback: SubscribeCallback,
	): Promise<UnSubscribeFn> {
		const topic = this.prefix(name);
		await this.redisSubscriberProvider.subscriber.subscribe(topic);

		if (!this.subscriptions[topic]) {
			this.subscriptions[topic] = [];
		}

		this.subscriptions[topic].push(callback);

		return () => this.unsubscribe(name, callback);
	}

	/**
	 * Unsubscribe from a topic.
	 *
	 * @param name
	 * @param callback
	 */
	public async unsubscribe(
		name: string,
		callback?: SubscribeCallback,
	): Promise<void> {
		const topic = this.prefix(name);

		if (callback) {
			if (!this.subscriptions[topic]) {
				return;
			}

			this.subscriptions[topic] = this.subscriptions[topic].filter(
				(cb) => cb !== callback,
			);

			if (this.subscriptions[topic].length > 0) {
				return;
			}
		}

		await this.redisSubscriberProvider.subscriber.unsubscribe(topic);
		delete this.subscriptions[topic];
	}

	/**
	 * Listen for messages.
	 *
	 * @protected
	 */
	protected listen() {
		this.redisSubscriberProvider.subscriber.on(
			"message",
			(channel, message) => {
				const callbacks = this.subscriptions[channel];
				if (!callbacks) {
					return;
				}

				for (const callback of callbacks) {
					callback(message);
				}
			},
		);
	}
}
