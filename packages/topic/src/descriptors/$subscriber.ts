import {
	__descriptor,
	KIND,
	NotImplementedError,
	OPTIONS,
	type Static,
} from "@alepha/core";
import type { TopicDescriptor, TopicMessageSchema } from "./$topic.ts";

const KEY = "SUBSCRIBER";

export interface SubscriberDescriptorOptions<
	T extends TopicMessageSchema = TopicMessageSchema,
> {
	topic: TopicDescriptor<T>;

	handler: (message: { payload: Static<T["payload"]> }) => Promise<void>;
}

export interface SubscriberDescriptor<
	T extends TopicMessageSchema = TopicMessageSchema,
> {
	[KIND]: typeof KEY;
	[OPTIONS]: SubscriberDescriptorOptions<T>;

	topic: () => TopicDescriptor<T>;
}

/**
 * Subscriber descriptor.
 *
 * @param options - The subscriber options.
 * @returns The descriptor value.
 */
export const $subscriber = <T extends TopicMessageSchema>(
	options: SubscriberDescriptorOptions<T>,
): SubscriberDescriptor<T> => {
	__descriptor(KEY);
	return {
		[KIND]: KEY,
		[OPTIONS]: options,
		topic: () => {
			throw new NotImplementedError(KEY);
		},
	};
};

$subscriber[KIND] = KEY;
