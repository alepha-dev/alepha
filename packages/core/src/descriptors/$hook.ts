import type { Hooks } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import {
	createDescriptor,
	Descriptor,
	type DescriptorArgs,
} from "../helpers/descriptor.ts";
import type { Async } from "../interfaces/Async.ts";

/**
 * Registers a new hook.
 *
 * ```ts
 * import { $hook } from "alepha";
 *
 * class MyProvider {
 *   onStart = $hook({
 *     name: "start", // or "configure", "ready", "stop", ...
 *     handler: async (app) => {
 *       // await db.connect(); ...
 *     }
 *   });
 * }
 * ```
 *
 * Hooks are used to run async functions from all registered providers/services.
 *
 * You can't register a hook after the App has started.
 *
 * It's used under the hood by the `configure`, `start`, and `stop` methods.
 * Some modules also use hooks to run their own logic. (e.g. `@alepha/server`).
 *
 * You can create your own hooks by using module augmentation:
 *
 * ```ts
 * declare module "@alepha/core" {
 *
 *   interface Hooks {
 *     "my:custom:hook": {
 *       arg1: string;
 *     }
 *   }
 * }
 *
 * await alepha.emit("my:custom:hook", { arg1: "value" });
 * ```
 *
 */
export const $hook = <T extends keyof Hooks>(options: HookOptions<T>) =>
	createDescriptor(HookDescriptor<T>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface HookOptions<T extends keyof Hooks> {
	/**
	 * The name of the hook. "configure", "start", "ready", "stop", ...
	 */
	on: T;

	/**
	 * The handler to run when the hook is triggered.
	 */
	handler: (app: Hooks[T]) => Async<any>;

	/**
	 * Force the hook to run first or last on the list of hooks.
	 */
	priority?: "first" | "last";

	/**
	 * Empty placeholder, not implemented yet. :-)
	 */
	before?: object | Array<object>;

	/**
	 * Empty placeholder, not implemented yet. :-)
	 */
	after?: object | Array<object>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class HookDescriptor<T extends keyof Hooks> extends Descriptor<
	HookOptions<T>
> {
	public called = 0;

	constructor(args: DescriptorArgs<HookOptions<T>>) {
		super(args);

		this.alepha.on(this.options.on, {
			caller: args.service,
			priority: this.options.priority,
			callback: async (args: any) => {
				this.called += 1;
				await this.options.handler(args);
			},
		});
	}
}

$hook[KIND] = HookDescriptor;
