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
import { MemoryQueueProvider } from "../providers/MemoryQueueProvider.ts";
import { QueueProvider } from "../providers/QueueProvider.ts";
import { WorkerProvider } from "../providers/WorkerProvider.ts";

/**
 * Create a new queue.
 */
export const $queue = <T extends TSchema>(
	options: QueueDescriptorOptions<T>,
): QueueDescriptor<T> => {
	return createDescriptor(QueueDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface QueueDescriptorOptions<T extends TSchema> {
	name?: string; // or use the key
	description?: string;
	provider?: "memory" | Service<QueueProvider>;
	schema: T;
	handler?: (message: QueueMessage<T>) => Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class QueueDescriptor<T extends TSchema> extends Descriptor<
	QueueDescriptorOptions<T>
> {
	protected readonly log = $logger();
	protected readonly workerProvider = $inject(WorkerProvider);
	public readonly provider = this.$provider();

	public async push(...payloads: Array<Static<T>>) {
		await Promise.all(
			payloads.map((payload) =>
				this.provider.push(
					this.name,
					JSON.stringify({
						headers: {},
						payload: this.alepha.parse(this.options.schema, payload),
					}),
				),
			),
		);

		this.log.debug(`Pushed to queue ${this.name}`, payloads);
		this.workerProvider.wakeUp();
	}

	public get name() {
		return this.options.name || this.config.propertyKey;
	}

	protected $provider() {
		if (!this.options.provider) {
			return this.alepha.inject(QueueProvider);
		}
		if (this.options.provider === "memory") {
			return this.alepha.inject(MemoryQueueProvider);
		}
		return this.alepha.inject(this.options.provider);
	}
}

$queue[KIND] = QueueDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface QueueMessageSchema {
	payload: TSchema;
}

export interface QueueMessage<T extends TSchema> {
	payload: Static<T>;
}
