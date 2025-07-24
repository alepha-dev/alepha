import {
	$inject,
	$logger,
	createDescriptor,
	Descriptor,
	KIND,
	type Service,
	type Static,
	type TSchema,
} from "@alepha/core";
import {
	DateTimeProvider,
	type DurationLike,
	type Timeout,
} from "@alepha/datetime";
import { TopicTimeoutError } from "../errors/TopicTimeoutError.ts";
import { MemoryTopicProvider } from "../providers/MemoryTopicProvider.ts";
import {
	TopicProvider,
	type UnSubscribeFn,
} from "../providers/TopicProvider.ts";

/**
 * Create a new topic.
 */
export const $topic = <T extends TopicMessageSchema>(
	options: TopicDescriptorOptions<T>,
): TopicDescriptor<T> => {
	return createDescriptor(TopicDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface TopicDescriptorOptions<T extends TopicMessageSchema> {
	/**
	 * Topic key.
	 *
	 * If not provided, the propertyKey is used as the topic name.
	 */
	name?: string;

	/**
	 * Describe the topic. For documentation purposes.
	 */
	description?: string;

	/**
	 * Override the default topic provider.
	 *
	 * If not provided, the default provider is used.
	 * If "memory" is provided, the default in-memory provider is used.
	 * If a class is provided, it must extend `TopicProvider`.
	 */
	provider?: "memory" | Service<TopicProvider>;

	/**
	 * Topic message schema.
	 */
	schema: T;

	/**
	 * Add a subscriber handler.
	 */
	handler?: TopicHandler<T>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class TopicDescriptor<T extends TopicMessageSchema> extends Descriptor<
	TopicDescriptorOptions<T>
> {
	protected readonly log = $logger();
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	public readonly provider = this.$provider();

	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	public async publish(payload: TopicMessage<T>["payload"]): Promise<void> {
		await this.provider.publish(
			this.name,
			JSON.stringify({
				payload: this.alepha.parse(this.options.schema.payload, payload),
			}),
		);
	}

	public async subscribe(handler: TopicHandler<T>): Promise<UnSubscribeFn> {
		return this.provider.subscribe(this.name, async (message) => {
			try {
				await handler(this.parseMessage(message));
			} catch (error) {
				this.log.error(error);
			}
		});
	}

	public async wait(
		options: TopicWaitOptions<T> = {},
	): Promise<TopicMessage<T>> {
		const filter = options.filter ?? (() => true);

		return new Promise((resolve, reject) => {
			const ref: { timeout?: Timeout } = {};

			(async () => {
				const clear = await this.provider.subscribe(this.name, (raw) => {
					const message = this.parseMessage(raw);
					if (!filter(message)) {
						return;
					}

					ref.timeout?.clear();
					clear();
					resolve(message);
				});

				const timeoutDuration = options.timeout ?? [10, "seconds"];

				ref.timeout = this.dateTimeProvider.createTimeout(() => {
					clear();
					reject(
						new TopicTimeoutError(
							this.name,
							this.dateTimeProvider.duration(timeoutDuration).asMilliseconds(),
						),
					);
				}, timeoutDuration);
			})();
		});
	}

	protected $provider(): TopicProvider {
		if (!this.options.provider) {
			return this.alepha.inject(TopicProvider);
		}

		if (this.options.provider === "memory") {
			return this.alepha.inject(MemoryTopicProvider);
		}

		return this.alepha.inject(this.options.provider);
	}

	protected parseMessage(message: string): TopicMessage<T> {
		const { payload } = JSON.parse(message);
		return {
			payload: this.alepha.parse(this.options.schema.payload, payload),
		};
	}
}

$topic[KIND] = TopicDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface TopicMessage<T extends TopicMessageSchema> {
	payload: Static<T["payload"]>;
}

export interface TopicWaitOptions<T extends TopicMessageSchema> {
	timeout?: DurationLike;
	filter?: (message: { payload: Static<T["payload"]> }) => boolean;
}

export interface TopicMessageSchema {
	headers?: TSchema;
	payload: TSchema;
}

export type TopicHandler<T extends TopicMessageSchema = TopicMessageSchema> = (
	message: TopicMessage<T>,
) => unknown;
