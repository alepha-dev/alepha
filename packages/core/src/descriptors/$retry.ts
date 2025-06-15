import type { MaybePromise } from "../interfaces/Async.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Retry Descriptor options.
 */
export interface RetryDescriptorOptions<T extends (...args: any[]) => any> {
	/**
	 * Maximum number of attempts.
	 *
	 * @default 3
	 */
	max?: number;

	/**
	 * Delay in milliseconds.
	 *
	 * @default 0
	 */
	delay?: number;

	/**
	 * Optional condition to determine when to retry.
	 */
	when?: (error: Error) => boolean;

	/**
	 * The function to retry.
	 */
	handler: T;

	/**
	 * Optional error handler.
	 *
	 * This will be called when an error occurs.
	 *
	 * @default undefined
	 */
	onError?: (
		error: Error,
		attempt: number,
		...parameters: Parameters<T>
	) => void;
}

// ---------------------------------------------------------------------------------------------------------------------

export type RetryDescriptor<T extends (...args: any[]) => any> = (
	...parameters: Parameters<T>
) => MaybePromise<ReturnType<T>>;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * `$retry` creates a retry descriptor.
 *
 * It will retry the given function up to `max` times with a delay of `delay` milliseconds between attempts.
 *
 * @example
 * ```ts
 * import { $retry } from "@alepha/core";
 *
 * class MyService {
 * 	fetchData = $retry({
 * 		max: 5, // maximum number of attempts
 * 		delay: 1000, // ms
 * 		when: (error) => error.message.includes("Network Error"),
 * 		handler: async (url: string) => {
 * 			const response = await fetch(url);
 * 			if (!response.ok) {
 * 				throw new Error(`Failed to fetch: ${response.statusText}`);
 * 			}
 * 			return response.json();
 * 		},
 * 		onError: (error, attempt, url) => {
 * 	    // error happened, log it or handle it
 * 			console.error(`Attempt ${attempt} failed for ${url}:`, error);
 * 		},
 * 	});
 * }
 * ```
 */
export const $retry = <T extends (...args: any[]) => any>(
	opts: RetryDescriptorOptions<T>,
): RetryDescriptor<T> => {
	const attempts = opts.max ?? 3;
	const delay = opts.delay ?? 0;
	const when = opts.when;
	const handler = opts.handler;

	const func = async (...args: Parameters<T>) => {
		let counter = 0;

		while (counter < attempts) {
			try {
				return await handler(...args);
			} catch (err) {
				const isError = err instanceof Error;

				if (!isError) {
					throw err;
				}

				if (typeof when === "function" && !when(err)) {
					throw err;
				}

				if (counter >= attempts - 1) {
					throw err;
				}

				if (opts.onError) {
					opts.onError(err, counter + 1, ...args);
				}

				if (delay) {
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}

			counter += 1;
		}
	};

	return func as T;
};

// ---------------------------------------------------------------------------------------------------------------------
