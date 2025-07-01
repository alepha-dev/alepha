import {
	$hook,
	$inject,
	$logger,
	Alepha,
	KIND,
	OPTIONS,
	type Static,
	t,
} from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
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
		priority: "last",
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
				[OPTIONS]: value[OPTIONS],
				name: () => value[OPTIONS].name ?? key,
				provider: () => this.provider(value[OPTIONS]),
				push(...payloads: any[]) {
					return push(this, ...payloads);
				},
			};

			this.state.queues.push($);

			if (value[OPTIONS].handler) {
				this.state.consumers.push({
					queue: $,
					handler: value[OPTIONS].handler,
				});
			}

			instance[key] = $;
		}
	}

	/**
	 * Process the consumer descriptors.
	 */
	protected processConsumerDescriptors() {
		const consumerDescriptors = this.alepha.getDescriptorValues($consumer);

		for (const { value } of consumerDescriptors) {
			for (const queue of this.state.queues) {
				if (value[OPTIONS].queue[OPTIONS] === queue[OPTIONS]) {
					this.state.consumers.push({
						queue,
						handler: value[OPTIONS].handler,
					});
				}
			}
		}
	}

	/**
	 * Get the provider for the queue.
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
						payload: this.alepha.parse(queue[OPTIONS].schema.payload, payload),
					}),
				),
			),
		);

		this.log.debug(`Pushed to queue ${queue.name()}`, payloads);

		// wake up workers!
		this.state.abortController.abort();
		this.state.abortController = new AbortController();
	}

	// -------------------------------------------------------------------------------------------------------------------

	// Engine part - this is the part that will run the workers and process the messages

	/**
	 * Start the workers.
	 * This method will create an endless loop that will check for new messages!
	 */
	protected startWorkers(consumers: Array<ConsumerDescriptorOptions>): void {
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
	 * Wait for the next message, where `n` is the worker number.
	 *
	 * This method will wait for a certain amount of time, increasing the wait time again if no message is found.
	 */
	protected async waitForNextMessage(n: number): Promise<void> {
		const intervals = this.state.workerIntervals;
		const milliseconds = intervals[n] || this.env.QUEUE_WORKER_INTERVAL;

		this.log.trace(`Worker n-${n} is waiting for ${milliseconds}ms.`);

		if (this.state.abortController.signal.aborted) {
			this.log.warn(`Worker n-${n} aborted.`);
			return;
		}

		await this.dateTimeProvider.wait(milliseconds, {
			signal: this.state.abortController.signal,
		});

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
	 */
	protected async getNextMessage(
		consumers: Array<ConsumerDescriptorOptions>,
	): Promise<
		| undefined
		| {
				consumer: ConsumerDescriptorOptions;
				message: string;
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
	 */
	protected async processMessage(response: {
		message: any;
		consumer: ConsumerDescriptorOptions;
	}) {
		const { message, consumer } = response;

		try {
			const json = JSON.parse(message);
			const payload = this.alepha.parse(
				consumer.queue[OPTIONS].schema.payload,
				json.payload,
			);
			await consumer.handler({ payload });
		} catch (e) {
			this.log.error(e);
		}
	}

	/**
	 * Stop the workers.
	 *
	 * This method will stop the workers and wait for them to finish processing.
	 */
	protected async stopWorkers() {
		this.state.isWorkersRunning = false;

		this.log.trace("Stopping workers...");
		this.state.abortController.abort();

		this.log.trace("Waiting for workers to finish...");
		await Promise.all(this.state.workerPromises);
	}
}
