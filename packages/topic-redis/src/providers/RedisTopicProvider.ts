import {
	$env,
	$hook,
	$inject,
	$logger,
	type Logger,
	type Static,
	type TObject,
	type TString,
	t,
} from "@alepha/core";
import { RedisProvider, RedisSubscriberProvider } from "@alepha/redis";
import type {
	SubscribeCallback,
	TopicProvider,
	UnSubscribeFn,
} from "@alepha/topic";

const envSchema: TObject<{
	REDIS_TOPIC_PREFIX: TString;
}> = t.object({
	REDIS_TOPIC_PREFIX: t.string({
		default: "topic",
	}),
});

export class RedisTopicProvider implements TopicProvider {
	protected readonly env: Static<typeof envSchema> = $env(envSchema);
	protected readonly redisProvider: RedisProvider = $inject(RedisProvider);
	protected readonly redisSubscriberProvider: RedisSubscriberProvider = $inject(
		RedisSubscriberProvider,
	);

	protected readonly log: Logger = $logger();

	protected readonly stop = $hook({
		on: "stop",
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
