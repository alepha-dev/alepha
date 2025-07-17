import { KIND } from "../constants/KIND.ts";
import { OPTIONS } from "../constants/OPTIONS.ts";
import type { CursorDescriptor } from "../descriptors/$cursor.ts";
import { $cursor } from "../descriptors/$cursor.ts";
import type { Service } from "../interfaces/Service.ts";

// ---------------------------------------------------------------------------------------------------------------------

class EventEmitterLike<TEvents extends { [key: string]: any }> {
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
export const descriptorEvents: EventEmitterLike<{
	create: CursorDescriptor & { [KIND]: string; provider?: Service };
}> = new EventEmitterLike();

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Register a descriptor.
 *
 * This is used to run the event "create" and allow auto-registration of descriptors.
 */
export const __descriptor = (kind: string): void => {
	descriptorEvents.emit("create", {
		...$cursor(),
		[KIND]: kind,
	});
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Auto-inject a class/module when a descriptor or a provider is created.
 *
 * Example, you auto-inject the ServerModule when a `$route` descriptor is used.
 * Or, you auto-inject the RedisModule when RedisClientProvider is injected.
 */
export const __bind = (
	descriptor: { [KIND]: string } | Service,
	to: Service,
): void => {
	if (!(KIND in descriptor)) {
		descriptorEvents.on("create", (ctx) => {
			if (!ctx.context.env.EXPLICIT_PROVIDERS && !ctx.context.isLocked()) {
				if (ctx[KIND] === "INJECT" && ctx.provider === descriptor) {
					ctx.context.with(to);
				}
			}
		});
		return;
	}

	descriptorEvents.on("create", (ctx) => {
		if (!ctx.context.env.EXPLICIT_PROVIDERS && !ctx.context.isLocked()) {
			if (ctx[KIND] === descriptor[KIND]) {
				ctx.context.with(to);
			}
		}
	});
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Check if the value is a descriptor instance.
 */
export const isDescriptorInstance = (
	value: any,
): value is DescriptorInstance => {
	return value?.[KIND] != null && typeof value[OPTIONS] === "object";
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The "$descriptor" function.
 */
export interface Descriptor<T extends object = any> {
	[KIND]: string; // this is required to be able to use auto-inject.
	(options: T): DescriptorInstance<T> | any; // any = some descriptors are fake right now.
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Result of the "$descriptor" function.
 */
export interface DescriptorInstance<T = object> {
	[KIND]: string; // this is required to be able to use `isDescriptorValue` during processing.
	[OPTIONS]: T;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Descriptor instance + his class instance + his member key.
 */
export interface DescriptorMember<T extends Descriptor> {
	value: ReturnType<T>;
	key: string;
	instance: Record<string, any>;
}
