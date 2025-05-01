import { KIND } from "../constants/KIND";
import type { STARTED } from "../constants/STARTED";
import type { CursorDescriptor } from "../descriptors/$cursor";
import { $cursor } from "../descriptors/$cursor";
import type { Class } from "../interfaces/Class";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Light-weight event emitter like.
 */
export class EventEmitterLike<TEvents extends { [key: string]: any }> {
	private hooks: {
		[key in keyof TEvents]?: ((data: TEvents[key]) => void)[];
	} = {};

	on<T extends keyof TEvents>(
		event: T,
		callback: (data: TEvents[T]) => void,
	): void {
		if (!this.hooks[event]) {
			this.hooks[event] = [];
		}

		this.hooks[event].push(callback);
	}

	emit<T extends keyof TEvents>(event: T, data: TEvents[T]): void {
		if (!this.hooks[event]) {
			return;
		}

		for (const callback of this.hooks[event]) {
			callback(data);
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Descriptor events.
 *
 * - `create` - Emitted when a descriptor is created.
 */
export const descriptorEvents = new EventEmitterLike<{
	create: CursorDescriptor & { [KIND]: string };
}>();

/**
 * Register a descriptor.
 *
 * This is used to run the event "create" and allow auto-registration of descriptors.
 *
 * @internal
 * @param kind
 */
export const __descriptor = (kind: string) => {
	descriptorEvents.emit("create", {
		...$cursor(),
		[KIND]: kind,
	});
};

/**
 * Auto-inject a class/module when a descriptor is created.
 *
 * Like, you auto-inject the ServerModule when a `$route` descriptor is used.
 *
 * @param whenDescriptor
 * @param classes
 */
export const autoInject = (
	whenDescriptor: { [KIND]: string },
	...classes: Class[]
) => {
	descriptorEvents.on("create", (ctx) => {
		if (!ctx.context.env.EXPLICIT_PROVIDERS && !ctx.context.isLocked()) {
			if (ctx[KIND] === whenDescriptor[KIND]) {
				for (const injectedClass of classes) {
					ctx.context.register(injectedClass);
				}
			}
		}
	});
};

/**
 * Check if the value is a descriptor value.
 *
 * @param value - Value to check.
 * @returns Is the value a descriptor value.
 */
export const isDescriptorValue = (
	value: any,
): value is DescriptorIdentifier => {
	return value?.[KIND] != null;
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The "$descriptor" function.
 */
export interface Descriptor<T extends object = any> {
	[KIND]: string; // this is required to be able to use auto-inject.
	(options: T): DescriptorIdentifier<T>;
}

/**
 * Class member descriptor.
 */
export interface DescriptorIdentifier<T = object> {
	[KIND]: string; // this is required to be able to use `isDescriptorValue` during processing.
	options: T;
}

/**
 * Descriptor identifier + his instance + his key.
 */
export interface DescriptorItem<T extends Descriptor> {
	value: ReturnType<T>;
	key: string;
	instance: Record<string, any> & {
		[STARTED]?: boolean;
	};
}
