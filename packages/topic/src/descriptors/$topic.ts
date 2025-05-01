import type { DurationLike, Static, TSchema } from "@alepha/core";
import { __descriptor, KIND, NotImplementedError } from "@alepha/core";
import type { TopicProvider, UnSubscribeFn } from "../providers/TopicProvider";

const KEY = "TOPIC";

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
	options: TopicDescriptorOptions<T>;
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

export const $topic = <T extends TopicMessageSchema>(
	options: TopicDescriptorOptions<T>,
): TopicDescriptor<T> => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		options,
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
