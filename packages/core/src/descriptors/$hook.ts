import type { Hooks } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { OPTIONS } from "../constants/OPTIONS.ts";
import { __descriptor } from "../helpers/descriptor.ts";
import type { Async } from "../interfaces/Async.ts";
import type { Service } from "../interfaces/Service.ts";
import { $cursor } from "./$cursor.ts";

const KEY = "HOOK";

export interface HookOptions<T extends keyof Hooks> {
	/**
	 * The name of the hook. "configure", "start", "ready", "stop", ...
	 */
	name: T;

	/**
	 * The handler to run when the hook is triggered.
	 */
	handler: (app: Hooks[T]) => Async<any>;

	/**
	 * Force the hook to run first or last on the list of hooks.
	 */
	priority?: "first" | "last";

	/**
	 * Empty placeholder, not working yet. :-)
	 */
	before?: object | Array<object>;

	/**
	 * Empty placeholder, not working yet. :-)
	 */
	after?: object | Array<object>;
}

export interface Hook<T extends keyof Hooks = any> {
	caller?: Service;
	priority?: "first" | "last";
	callback: (payload: Hooks[T]) => Async<void>;
}

export interface HookDescriptor<T extends keyof Hooks> {
	[KIND]: typeof KEY;
	[OPTIONS]: HookOptions<T>;
	(app: Hooks[T]): Async<any>;

	//TODO:
	/*
	   .called - number of times the hook has been called
	   .calledAt - last time the hook was called
	   .paused() - boolean - if the hook is paused
	   .pausedAt - number - when the hook was paused
	   .resume() - function to resume the hook
	 */
}

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
export const $hook = <T extends keyof Hooks>(
	options: HookOptions<T>,
): HookDescriptor<T> => {
	__descriptor(KEY);

	const { context, definition } = $cursor();

	if (!definition) {
		throw new Error("Hook must be called inside a class");
	}

	context.on(options.name, {
		caller: definition,
		priority: options.priority,
		callback: options.handler,
	});

	const $: HookDescriptor<T> = (arg: Hooks[T]) => options.handler(arg);

	$[KIND] = KEY;
	$[OPTIONS] = options;

	return $;
};

$hook[KIND] = KEY;
