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
	 *
	 */
	when?: (error: Error) => boolean;

	/**
	 *
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

export type MaybePromise<T> = T extends Promise<any> ? T : Promise<T>;

/**
 * Retry descriptor.
 *
 * @param opts - Retry descriptor options.
 * @returns A function that will retry the handler.
 */
export const $retry = <T extends (...args: any[]) => any>(
	opts: RetryDescriptorOptions<T>,
): ((...parameters: Parameters<T>) => MaybePromise<ReturnType<T>>) => {
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
