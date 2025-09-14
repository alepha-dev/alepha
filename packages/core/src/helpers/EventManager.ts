import type { Hook, Hooks } from "../Alepha.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { Async } from "../interfaces/Async.ts";
import type { LoggerInterface } from "../interfaces/LoggerInterface.ts";

export class EventManager {
	protected logFn?: () => LoggerInterface | undefined;

	/**
	 * List of events that can be triggered. Powered by $hook().
	 */
	protected events: Record<string, Array<Hook>> = {};

	constructor(logFn?: () => LoggerInterface | undefined) {
		this.logFn = logFn;
	}

	protected get log(): LoggerInterface | undefined {
		return this.logFn?.();
	}

	/**
	 * Registers a hook for the specified event.
	 */
	public on<T extends keyof Hooks>(
		event: T,
		hookOrFunc: Hook<T> | ((payload: Hooks[T]) => Async<void>),
	): () => void {
		if (!this.events[event]) {
			this.events[event] = [];
		}

		const hook =
			typeof hookOrFunc === "function" ? { callback: hookOrFunc } : hookOrFunc;

		if (hook.priority === "first") {
			this.events[event].unshift(hook);
		} else if (hook.priority === "last") {
			this.events[event].push(hook);
		} else {
			const index = this.events[event].findIndex(
				(it) => it.priority === "last",
			);
			if (index !== -1) {
				this.events[event].splice(index, 0, hook);
			} else {
				this.events[event].push(hook);
			}
		}

		return () => {
			this.events[event] = this.events[event].filter(
				(it) => it.callback !== hook.callback,
			);
		};
	}

	/**
	 * Emits the specified event with the given payload.
	 */
	public async emit<T extends keyof Hooks>(
		func: keyof Hooks,
		payload: Hooks[T],
		options: {
			/**
			 * If true, the hooks will be executed in reverse order.
			 * This is useful for "stop" hooks that should be executed in reverse order.
			 *
			 * @default false
			 */
			reverse?: boolean;
			/**
			 * If true, the hooks will be logged with their execution time.
			 *
			 * @default false
			 */
			log?: boolean;
			/**
			 * If true, errors will be caught and logged instead of throwing.
			 *
			 * @default false
			 */
			catch?: boolean;
		} = {},
	): Promise<void> {
		const ctx: any = {};

		if (options.log) {
			ctx.now = Date.now();
			this.log?.trace(`${func} ...`);
		}

		let events = this.events[func] ?? [];

		if (options.reverse) {
			events = events.toReversed();
		}

		for (const hook of events) {
			const name = hook.caller?.name ?? "unknown";
			if (options.log) {
				ctx.now2 = Date.now();
				this.log?.trace(`${func}(${name}) ...`);
			}

			try {
				await hook.callback(payload);
			} catch (error) {
				if (options.catch) {
					this.log?.error(`${func}(${name}) ERROR`, error);
					continue;
				}
				if (options.log) {
					throw new AlephaError(
						`Failed during '${func}()' hook for service: ${name}`,
						{ cause: error },
					);
				}
				throw error;
			}

			if (options.log) {
				this.log?.debug(`${func}(${name}) OK [${Date.now() - ctx.now2}ms]`);
			}
		}

		if (options.log) {
			this.log?.debug(`${func} OK [${Date.now() - ctx.now}ms]`);
		}
	}
}
