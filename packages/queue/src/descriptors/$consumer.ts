import type { Static } from "@alepha/core";
import { __descriptor, KIND, NotImplementedError } from "@alepha/core";
import type { QueueDescriptor, QueueMessageSchema } from "./$queue.ts";

const KEY = "CONSUMER";

export interface ConsumerDescriptorOptions<
	T extends QueueMessageSchema = QueueMessageSchema,
> {
	queue: QueueDescriptor<T>;
	handler: (message: { payload: Static<T["payload"]> }) => Promise<void>;
}

export interface ConsumerDescriptor<
	T extends QueueMessageSchema = QueueMessageSchema,
> {
	[KIND]: typeof KEY;
	options: ConsumerDescriptorOptions<T>;

	queue(): QueueDescriptor<T>;
	stop(): Promise<void>;
}

/**
 * Consumer descriptor.
 *
 * @param options - The consumer options.
 * @returns The descriptor value.
 */
export const $consumer = <T extends QueueMessageSchema>(
	options: ConsumerDescriptorOptions<T>,
): ConsumerDescriptor<T> => {
	__descriptor(KEY);

	return {
		[KIND]: KEY,
		options,
		queue: () => {
			throw new NotImplementedError(KEY);
		},
		stop: async () => {
			throw new NotImplementedError(KEY);
		},
	};
};

$consumer[KIND] = KEY;
