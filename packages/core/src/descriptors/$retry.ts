/**
 * Retry Descriptor options.
 */
export interface RetryDescriptorOptions<T extends (...args: any[]) => any> {
	/**
	 *
	 */
	max?: number;

	/**
	 *
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
}

/**
 * Retry descriptor.
 *
 * @param opts - Retry descriptor options.
 * @returns A function that will retry the handler.
 */
export const $retry = <T extends (...args: any[]) => any>(
	opts: RetryDescriptorOptions<T>,
): ((...parameters: Parameters<T>) => Promise<ReturnType<T>>) => {
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

				if (delay) {
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}

			counter += 1;
		}
	};

	return func as T;
};
