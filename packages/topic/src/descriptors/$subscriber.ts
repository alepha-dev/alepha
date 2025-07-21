import { createDescriptor, Descriptor, KIND } from "@alepha/core";
import type {
	TopicDescriptor,
	TopicHandler,
	TopicMessageSchema,
} from "./$topic.ts";

/**
 * Subscribe to a $topic.
 */
export const $subscriber = <T extends TopicMessageSchema>(
	options: SubscriberDescriptorOptions<T>,
): SubscriberDescriptor<T> => {
	return createDescriptor(SubscriberDescriptor<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface SubscriberDescriptorOptions<T extends TopicMessageSchema> {
	topic: TopicDescriptor<T>;
	handler: TopicHandler<T>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class SubscriberDescriptor<
	T extends TopicMessageSchema,
> extends Descriptor<SubscriberDescriptorOptions<T>> {}

$subscriber[KIND] = SubscriberDescriptor;
