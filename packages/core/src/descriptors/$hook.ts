import type { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { __descriptor } from "../helpers/descriptor.ts";
import type { Async } from "../interfaces/Async.ts";

const KEY = "HOOK";

export interface Hooks {
	/**
	 * Triggered during the configuration phase. Before the start phase.
	 *
	 * - Configuration should technically be called many times without any side effects.
	 * - Spamming Alepha#configure() should not cause any issues.
	 */
	configure: Alepha;

	/**
	 * Triggered during the start phase. When `Alepha#start()` is called.
	 *
	 * - Start is called only once. It should not be called multiple times.
	 */
	start: Alepha;

	/**
	 * Triggered during the ready phase. After the start phase.
	 *
	 * - Ready is called only once. It should not be called multiple times.
	 */
	ready: Alepha;

	/**
	 * Triggered during the stop phase.
	 *
	 * - Stop is called only once. It should not be called multiple times.
	 * - Stop should be called after a SIGINT or SIGTERM signal in order to gracefully shutdown the application.
	 */
	stop: Alepha;
}

export interface HookOptions<T extends keyof Hooks> {
	/**
	 * The name of the hook. "configure", "start", "ready", "stop", ...
	 */
	name: T;

	/**
	 * The handler to run when the hook is triggered.
	 */
	handler: (app: Hooks[T]) => Async<any>;

	before?: object | Array<object>;

	after?: object | Array<object>;

	priority?: "first" | "last" | number;
}

export interface HookDescriptor<T extends keyof Hooks> {
	[KIND]: typeof KEY;
	options: HookOptions<T>;
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
 * - You can't unregister a hook once it has been registered.
 * - You can't register a hook after the App has started.
 *
 * It's used under the hood by the `configure`, `start`, and `stop` methods.
 * Some modules also use hooks to run their own logic.
 */
export const $hook = <T extends keyof Hooks>(
	options: HookOptions<T>,
): HookDescriptor<T> => {
	__descriptor(KEY);

	const $: HookDescriptor<T> = (arg: Hooks[T]) => options.handler(arg);

	$[KIND] = KEY;
	$.options = options;

	return $;
};

$hook[KIND] = KEY;
