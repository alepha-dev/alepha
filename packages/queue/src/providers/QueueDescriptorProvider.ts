import type { Static } from "@alepha/core";
import {
	$hook,
	$inject,
	$logger,
	Alepha,
	DateTimeProvider,
	KIND,
	t,
} from "@alepha/core";
import type { ConsumerDescriptorOptions } from "../descriptors/$consumer.ts";
import { $consumer } from "../descriptors/$consumer.ts";
import type {
	QueueDescriptor,
	QueueDescriptorOptions,
	QueueMessageSchema,
} from "../descriptors/$queue.ts";
import { $queue } from "../descriptors/$queue.ts";
import { MemoryQueueProvider } from "./MemoryQueueProvider.ts";
import { QueueProvider } from "./QueueProvider.ts";

const envSchema = t.object({
	/**
	 * The interval in milliseconds to wait before checking for new messages.
	 */
	QUEUE_WORKER_INTERVAL: t.uint({
		default: 1000,
	}),
	/**
	 * The maximum interval in milliseconds to wait before checking for new messages.
	 */
	QUEUE_WORKER_MAX_INTERVAL: t.uint({
		default: 32000,
	}),
	/**
	 * The number of workers to run concurrently. Defaults to 1.
	 * Useful only if you are doing a lot of I/O.
	 */
	QUEUE_WORKER_CONCURRENCY: t.uint({
		default: 1,
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export interface QueueDescriptorProviderState {
	queues: Array<QueueDescriptor>;
	consumers: Array<ConsumerDescriptorOptions>;
	workerPromises: Array<Promise<void>>;
	isWorkersRunning: boolean;
	abortController: AbortController;
	workerIntervals: Record<number, number>;
}

export class QueueDescriptorProvider {
	protected readonly log = $logger();
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly queueProvider = $inject(QueueProvider);
	protected readonly memoryQueueProvider = $inject(MemoryQueueProvider);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly state: QueueDescriptorProviderState = {
		queues: [],
		consumers: [],
		workerPromises: [],
		isWorkersRunning: false,
		abortController: new AbortController(),
		workerIntervals: {},
	};

	protected readonly configure = $hook({
		name: "configure",
		handler: () => {
			this.processDescriptors();
		},
	});

	protected readonly start = $hook({
		name: "start",
		handler: () => {
			if (this.state.consumers.length > 0) {
				this.startWorkers(this.state.consumers);
			}
		},
	});

	protected readonly stop = $hook({
		name: "stop",
		handler: async () => {
			if (this.state.consumers.length > 0) {
				await this.stopWorkers();
			}
		},
	});

	public getQueues() {
		return this.state.queues;
	}

	public getConsumers() {
		return this.state.consumers;
	}

	/**
	 * Process the descriptors.
	 *
	 * @protected
	 */
	protected processDescriptors() {
		this.processQueueDescriptors();
		this.processConsumerDescriptors();
	}

	/**
	 * Process the queue descriptors.
	 *
	 * @protected
	 */
	protected processQueueDescriptors() {
		const queueDescriptors = this.alepha.getDescriptorValues($queue);

		for (const { value, instance, key } of queueDescriptors) {
			const push = (q: QueueDescriptor, ...payloads: any[]) =>
				this.push(q, ...payloads);

			const $: QueueDescriptor = {
				[KIND]: value[KIND],
				options: value.options,
				name: () => value.options.name ?? key,
				provider: () => this.provider(value.options),
				push(...payloads: any[]) {
					return push(this, ...payloads);
				},
			};

			this.state.queues.push($);

			if (value.options.handler) {
				this.state.consumers.push({
					queue: $,
					handler: value.options.handler,
				});
			}

			instance[key] = $;
		}
	}

	/**
	 * Process the consumer descriptors.
	 *
	 * @protected
	 */
	protected processConsumerDescriptors() {
		const consumerDescriptors = this.alepha.getDescriptorValues($consumer);

		for (const { value } of consumerDescriptors) {
			for (const queue of this.state.queues) {
				if (value.options.queue.options === queue.options) {
					this.state.consumers.push({
						queue,
						handler: value.options.handler,
					});
				}
			}
		}
	}

	/**
	 * Start the workers.
	 *
	 * @param consumers
	 * @protected
	 */
	protected startWorkers(consumers: Array<ConsumerDescriptorOptions>) {
		if (this.state.isWorkersRunning) {
			return;
		}

		this.state.isWorkersRunning = true;
		for (let i = 0; i < this.env.QUEUE_WORKER_CONCURRENCY; i++) {
			this.log.debug(`Starting worker n-${i}`);
			this.state.workerPromises.push(
				(async () => {
					while (this.state.isWorkersRunning) {
						this.log.trace(`Worker n-${i} is checking for new messages.`);
						const next = await this.getNextMessage(consumers);
						if (next) {
							this.state.workerIntervals[i] = 0;
							await this.processMessage(next);
						} else {
							await this.waitForNextMessage(i);
						}
					}
				})().catch((error) => {
					this.log.error(error);
				}),
			);
		}
	}

	/**
	 * Wait for the next message.
	 *
	 * @param n
	 * @protected
	 */
	protected async waitForNextMessage(n: number) {
		const intervals = this.state.workerIntervals;
		const milliseconds = intervals[n] || this.env.QUEUE_WORKER_INTERVAL;

		this.log.trace(`Worker n-${n} is waiting for ${milliseconds}ms.`);

		await this.dateTimeProvider.wait(
			{ milliseconds },
			this.state.abortController.signal,
		);

		if (intervals[n]) {
			if (intervals[n] < this.env.QUEUE_WORKER_MAX_INTERVAL) {
				intervals[n] = intervals[n] * 2;
			}
		} else {
			intervals[n] = milliseconds;
		}
	}

	/**
	 * Get the next message.
	 *
	 * @param consumers
	 * @protected
	 */
	protected async getNextMessage(
		consumers: Array<ConsumerDescriptorOptions>,
	): Promise<
		| undefined
		| {
				message: any;
				consumer: ConsumerDescriptorOptions;
		  }
	> {
		for (const consumer of consumers) {
			const provider = consumer.queue.provider();
			const message = await provider.pop(consumer.queue.name());
			if (message) {
				return { message, consumer };
			}
		}
	}

	/**
	 * Process a message from a queue.
	 *
	 * @param response
	 * @protected
	 */
	protected async processMessage(response: {
		message: any;
		consumer: ConsumerDescriptorOptions;
	}) {
		const { message, consumer } = response;

		try {
			const json = JSON.parse(message);
			const payload = this.alepha.parse(
				consumer.queue.options.schema.payload,
				json.payload,
			);
			await consumer.handler({ payload });
		} catch (e) {
			this.log.error(e);
		}
	}

	/**
	 * Stop the workers
	 *
	 * @protected
	 */
	protected async stopWorkers() {
		this.state.isWorkersRunning = false;
		this.state.abortController.abort();
		await Promise.all(this.state.workerPromises);
	}

	/**
	 * Get the provider for the queue.
	 *
	 * @param options - The queue options.
	 * @protected
	 */
	protected provider(options: QueueDescriptorOptions<any>): QueueProvider {
		if (options.provider === "memory") {
			return this.memoryQueueProvider;
		}

		if (typeof options.provider === "function") {
			return options.provider();
		}

		return this.queueProvider;
	}

	/**
	 * Push an item to the queue.
	 *
	 * @param queue
	 * @param payloads
	 * @protected
	 */
	protected async push<T extends QueueMessageSchema>(
		queue: QueueDescriptor<T>,
		...payloads: Array<Static<T["payload"]>>
	): Promise<void> {
		const provider = queue.provider();

		await Promise.all(
			payloads.map((payload) =>
				provider.push(
					queue.name(),
					JSON.stringify({
						headers: {},
						payload: this.alepha.parse(queue.options.schema.payload, payload),
					}),
				),
			),
		);

		this.log.debug(`Pushed to queue ${queue.name()}`, payloads);

		// wake up workers
		this.state.abortController.abort();
	}
}
