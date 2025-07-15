import {
	__descriptor,
	KIND,
	NotImplementedError,
	OPTIONS,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import type {
	TopicProvider,
	UnSubscribeFn,
} from "../providers/TopicProvider.ts";

const KEY = "TOPIC";

/**
 * Create a new topic.
 */
export const $topic = <T extends TopicMessageSchema>(
	options: TopicDescriptorOptions<T>,
): TopicDescriptor<T> => {
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
		publish: async () => {
			throw new NotImplementedError(KEY);
		},
		subscribe: async () => {
			throw new NotImplementedError(KEY);
		},
		wait: async () => {
			throw new NotImplementedError(KEY);
		},
	};
};

$topic[KIND] = KEY;

export interface TopicMessageSchema {
	headers?: TSchema;
	payload: TSchema;
}

export interface TopicDescriptorOptions<
	T extends TopicMessageSchema = TopicMessageSchema,
> {
	name?: string; // or use the key
	description?: string;
	provider?: "memory" | (() => TopicProvider);
	schema: T;
	handler?: (message: { payload: Static<T["payload"]> }) => Promise<void>;
}

export interface TopicDescriptor<
	T extends TopicMessageSchema = TopicMessageSchema,
> {
	[KIND]: typeof KEY;
	[OPTIONS]: TopicDescriptorOptions<T>;
	name(): string;
	provider(): TopicProvider;
	publish(payload: Static<T["payload"]>): Promise<void>;
	subscribe(fn: (message: TopicMessage<T>) => void): Promise<UnSubscribeFn>;
	wait(options?: TopicWaitOptions<T>): Promise<Static<T["payload"]>>;
}

export interface TopicMessage<
	T extends TopicMessageSchema = TopicMessageSchema,
> {
	payload: Static<T["payload"]>;
}

export interface TopicWaitOptions<T extends TopicMessageSchema> {
	timeout?: DurationLike;
	filter?: (message: { payload: Static<T["payload"]> }) => boolean;
}
