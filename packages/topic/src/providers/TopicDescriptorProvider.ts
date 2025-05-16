import { OPTIONS } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, KIND } from "@alepha/core";
import { DateTimeProvider, type Timeout } from "@alepha/datetime";
import type { SubscriberDescriptorOptions } from "../descriptors/$subscriber.ts";
import { $subscriber } from "../descriptors/$subscriber.ts";
import type {
	TopicDescriptor,
	TopicDescriptorOptions,
	TopicMessage,
	TopicMessageSchema,
	TopicWaitOptions,
} from "../descriptors/$topic.ts";
import { $topic } from "../descriptors/$topic.ts";
import { TopicTimeoutError } from "../errors/TopicTimeoutError.ts";
import { MemoryTopicProvider } from "./MemoryTopicProvider.ts";
import type { UnSubscribeFn } from "./TopicProvider.ts";
import { TopicProvider } from "./TopicProvider.ts";

export class TopicDescriptorProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly topicProvider = $inject(TopicProvider);
	protected readonly memoryTopicProvider = $inject(MemoryTopicProvider);
	protected readonly topics: TopicDescriptor[] = [];
	protected readonly subscribers: Array<
		SubscriberDescriptorOptions & { unsub?: UnSubscribeFn }
	> = [];

	protected readonly configure = $hook({
		name: "configure",
		handler: () => {
			this.processDescriptors();
		},
	});

	protected readonly start = $hook({
		name: "start",
		handler: async () => {
			for (const subscriber of this.subscribers) {
				const topicProvider = subscriber.topic.provider();
				subscriber.unsub = await topicProvider.subscribe(
					subscriber.topic.name(),
					async (message: string) => {
						await this.processMessage(subscriber, message);
					},
				);
			}
		},
	});

	/**
	 * Process the descriptors.
	 *
	 * @protected
	 */
	protected processDescriptors() {
		this.processTopicDescriptors();
		this.processSubscriberDescriptors();
	}

	/**
	 * Process the queue descriptors.
	 *
	 * @protected
	 */
	protected processTopicDescriptors() {
		const queueDescriptors = this.alepha.getDescriptorValues($topic);

		for (const { value, instance, key } of queueDescriptors) {
			const self = this;
			const $: TopicDescriptor = {
				[KIND]: value[KIND],
				[OPTIONS]: value[OPTIONS],
				name: () => value[OPTIONS].name ?? key,
				provider: () => this.provider(value[OPTIONS]),
				async publish(payload: any) {
					await self.publish(this, { payload });
				},
				subscribe(handler) {
					return this.provider().subscribe(this.name(), (message) => {
						handler(self.parseMessage(this[OPTIONS].schema.payload, message));
					});
				},
				wait(options) {
					return self.wait(this, options);
				},
			};

			this.topics.push($);

			if (value[OPTIONS].handler) {
				this.subscribers.push({
					topic: $,
					handler: value[OPTIONS].handler,
				});
			}

			instance[key] = $;
		}
	}

	/**
	 * Wait for a message on the topic.
	 *
	 * @param topic
	 * @param options
	 * @protected
	 */
	protected wait(topic: TopicDescriptor, options: TopicWaitOptions<any> = {}) {
		const filter = options.filter ?? (() => true);

		return new Promise((resolve, reject) => {
			const ref: { timeout?: Timeout } = {};

			(async () => {
				const clear = await topic
					.provider()
					.subscribe(topic.name(), (message) => {
						if (
							!filter(this.parseMessage(topic[OPTIONS].schema.payload, message))
						) {
							return;
						}

						ref.timeout?.clear();
						clear();
						resolve(message);
					});

				const timeoutDuration = options.timeout ?? { seconds: 10 };

				ref.timeout = this.dateTimeProvider.timeout(() => {
					clear();
					reject(
						new TopicTimeoutError(
							topic.name(),
							this.dateTimeProvider.duration(timeoutDuration).milliseconds,
						),
					);
				}, timeoutDuration);
			})();
		});
	}

	/**
	 * Process the consumer descriptors.
	 *
	 * @protected
	 */
	protected processSubscriberDescriptors() {
		const consumerDescriptors = this.alepha.getDescriptorValues($subscriber);

		for (const { value } of consumerDescriptors) {
			for (const topic of this.topics) {
				if (value[OPTIONS].topic[OPTIONS] === topic[OPTIONS]) {
					this.subscribers.push({
						topic,
						handler: value[OPTIONS].handler,
					});
				}
			}
		}
	}

	/**
	 * Get the provider for the queue.
	 *
	 * @param options - The queue options.
	 * @protected
	 */
	protected provider(options: TopicDescriptorOptions): TopicProvider {
		if (options.provider === "memory") {
			return this.memoryTopicProvider;
		}

		if (typeof options.provider === "function") {
			return options.provider();
		}

		return this.topicProvider;
	}

	/**
	 * Publish a message to the topic.
	 *
	 * @param topic
	 * @param message
	 * @protected
	 */
	protected async publish<T extends TopicMessageSchema = TopicMessageSchema>(
		topic: TopicDescriptor<T>,
		message: TopicMessage<T>,
	): Promise<void> {
		const provider = topic.provider();

		await provider.publish(
			topic.name(),
			JSON.stringify({
				payload: this.alepha.parse(
					topic[OPTIONS].schema.payload,
					message.payload,
				),
			}),
		);
	}

	/**
	 * Process a message.
	 *
	 * @param subscriber
	 * @param message
	 * @protected
	 */
	protected async processMessage(
		subscriber: SubscriberDescriptorOptions,
		message: string,
	) {
		try {
			await subscriber.handler(
				this.parseMessage(subscriber.topic[OPTIONS].schema.payload, message),
			);
		} catch (error) {
			this.log.error(error);
		}
	}

	protected parseMessage(schema: any, message: string): { payload: any } {
		const json = JSON.parse(message);
		return {
			payload: this.alepha.parse(schema, json.payload),
		};
	}
}
