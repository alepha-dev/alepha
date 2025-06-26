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

	protected readonly log = $logger();

	protected readonly stop = $hook({
		name: "stop",
		handler: async () => {
			this.redisSubscriberProvider.subscriber.removeAllListeners();
		},
	});

	public prefix(queue: string): string {
		return `${this.env.REDIS_TOPIC_PREFIX}:${queue}`;
	}

	/**
	 * Publish a message to a topic.
	 */
	public async publish(topic: string, message: string): Promise<void> {
		await this.redisProvider.publisher.publish(this.prefix(topic), message);
	}

	/**
	 * Subscribe to a topic.
	 */
	public async subscribe(
		name: string,
		callback: SubscribeCallback,
	): Promise<UnSubscribeFn> {
		const topic = this.prefix(name);
		await this.redisSubscriberProvider.subscriber.subscribe(topic, callback);

		return () => this.unsubscribe(name, callback);
	}

	/**
	 * Unsubscribe from a topic.
	 */
	public async unsubscribe(
		name: string,
		callback?: SubscribeCallback,
	): Promise<void> {
		const topic = this.prefix(name);

		await this.redisSubscriberProvider.subscriber.unsubscribe(topic, callback);
	}
}
