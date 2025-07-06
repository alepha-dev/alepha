import { KIND } from "../constants/KIND.ts";
import { OPTIONS } from "../constants/OPTIONS.ts";
import type { CursorDescriptor } from "../descriptors/$cursor.ts";
import { $cursor } from "../descriptors/$cursor.ts";
import type { Service } from "../interfaces/Service.ts";
import { EventEmitterLike } from "./EventEmitterLike.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Descriptor events.
 *
 * - `create` - Emitted when a descriptor is created.
 */
export const descriptorEvents: EventEmitterLike<{
	create: CursorDescriptor & { [KIND]: string };
}> = new EventEmitterLike();

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Register a descriptor.
 *
 * This is used to run the event "create" and allow auto-registration of descriptors.
 *
 * @internal
 * @param kind
 */
export const __descriptor = (kind: string): void => {
	descriptorEvents.emit("create", {
		...$cursor(),
		[KIND]: kind,
	});
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Auto-inject a class/module when a descriptor is created.
 *
 * Like, you auto-inject the ServerModule when a `$route` descriptor is used.
 *
 * @param descriptor
 * @param to
 */
export const __bind = (
	descriptor: { [KIND]: string },
	...to: Service[]
): void => {
	descriptorEvents.on("create", (ctx) => {
		if (!ctx.context.env.EXPLICIT_PROVIDERS && !ctx.context.isLocked()) {
			if (ctx[KIND] === descriptor[KIND]) {
				for (const injectedClass of to) {
					ctx.context.with(injectedClass);
				}
			}
		}
	});
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Check if the value is a descriptor value.
 *
 * @param value - Value to check.
 * @returns Is the value a descriptor value.
 */
export const isDescriptorValue = (
	value: any,
): value is DescriptorIdentifier => {
	return value?.[KIND] != null && typeof value[OPTIONS] === "object";
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The "$descriptor" function.
 */
export interface Descriptor<T extends object = any> {
	[KIND]: string; // this is required to be able to use auto-inject.
	(options: T): DescriptorIdentifier<T>;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Class member descriptor.
 */
export interface DescriptorIdentifier<T = object> {
	[KIND]: string; // this is required to be able to use `isDescriptorValue` during processing.
	[OPTIONS]: T;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Descriptor identifier + his instance + his key.
 */
export interface DescriptorItem<T extends Descriptor> {
	value: ReturnType<T>;
	key: string;
	instance: Record<string, any>;
}
