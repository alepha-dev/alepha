import {
	__descriptor,
	KIND,
	NotImplementedError,
	OPTIONS,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { QueueProvider } from "../providers/QueueProvider.ts";

const KEY = "QUEUE";

/**
 * Create a new queue.
 */
export const $queue = <T extends QueueMessageSchema>(
	options: QueueDescriptorOptions<T>,
): QueueDescriptor<T> => {
	__descriptor(KEY);

	return {
		[KIND]: KEY,
		[OPTIONS]: options,
		name: () => {
			throw new NotImplementedError(KEY);
		},
		provider: () => {
			throw new NotImplementedError(KEY);
		},
		push: async () => {
			throw new NotImplementedError(KEY);
		},
	};
};

$queue[KIND] = KEY;

// ---------------------------------------------------------------------------------------------------------------------

export interface QueueMessageSchema {
	headers?: TSchema;
	payload: TSchema;
}

export interface QueueDescriptorOptions<T extends QueueMessageSchema> {
	name?: string; // or use the key
	description?: string;
	provider?: "memory" | (() => QueueProvider);
	schema: T;
	handler?: (message: { payload: Static<T["payload"]> }) => Promise<void>;
}

export interface QueueDescriptor<
	T extends QueueMessageSchema = QueueMessageSchema,
> {
	[KIND]: typeof KEY;
	[OPTIONS]: QueueDescriptorOptions<T>;

	name(): string;
	provider(): QueueProvider;
	push(...payload: Array<Static<T["payload"]>>): Promise<void>;
}
