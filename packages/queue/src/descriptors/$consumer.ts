import {
	createDescriptor,
	Descriptor,
	KIND,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { QueueDescriptor } from "./$queue.ts";

/**
 * Consumer descriptor.
 */
export const $consumer = <T extends TSchema>(
	options: ConsumerDescriptorOptions<T>,
): ConsumerDescriptor<T> => {
	return createDescriptor(ConsumerDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ConsumerDescriptorOptions<T extends TSchema> {
	queue: QueueDescriptor<T>;
	handler: (message: { payload: Static<T["payload"]> }) => Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ConsumerDescriptor<T extends TSchema> extends Descriptor<
	ConsumerDescriptorOptions<T>
> {}

$consumer[KIND] = ConsumerDescriptor;
