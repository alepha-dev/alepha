import {
	$inject,
	createDescriptor,
	Descriptor,
	type DescriptorArgs,
	KIND,
} from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import { RetryCancelError } from "../errors/RetryCancelError.ts";
import { RetryTimeoutError } from "../errors/RetryTimeoutError.ts";

/**
 * Creates a function that automatically retries a handler upon failure,
 * with support for exponential backoff, max duration, and cancellation.
 */
export const $retry = <T extends (...args: any[]) => any>(
	options: RetryDescriptorOptions<T>,
): RetryDescriptorFn<T> => {
	const instance = createDescriptor(RetryDescriptor, options);
	const fn = (...args: Parameters<T>) => instance.run(...args);
	return Object.setPrototypeOf(fn, instance) as RetryDescriptorFn<T>;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RetryDescriptorOptions<T extends (...args: any[]) => any> {
	/**
	 * The function to retry.
	 */
	handler: T;

	/**
	 * The maximum number of attempts.
	 *
	 * @default 3
	 */
	max?: number;

	/**
	 * The backoff strategy for delays between retries.
	 * Can be a fixed number (in ms) or a configuration object for exponential backoff.
	 *
	 * @default { initial: 200, factor: 2, jitter: true }
	 */
	backoff?: number | RetryBackoffOptions;

	/**
	 * An overall time limit for all retry attempts combined.
	 *
	 * e.g., `[5, 'seconds']`
	 */
	maxDuration?: DurationLike;

	/**
	 * A function that determines if a retry should be attempted based on the error.
	 *
	 * @default (error) => true (retries on any error)
	 */
	when?: (error: Error) => boolean;

	/**
	 * A custom callback for when a retry attempt fails.
	 * This is called before the delay.
	 */
	onError?: (error: Error, attempt: number, ...args: Parameters<T>) => void;

	/**
	 * An AbortSignal to allow for external cancellation of the retry loop.
	 */
	signal?: AbortSignal;
}

// ---------------------------------------------------------------------------------------------------------------------

export class RetryDescriptor<
	T extends (...args: any[]) => any,
> extends Descriptor<RetryDescriptorOptions<T>> {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected appAbortController: AbortController;

	constructor(args: DescriptorArgs<RetryDescriptorOptions<T>>) {
		super(args);

		this.appAbortController = new AbortController();
		this.alepha.events.on("stop", () => {
			this.appAbortController.abort();
		});
	}

	async run(...args: Parameters<T>): Promise<ReturnType<T>> {
		const maxAttempts = this.options.max ?? 3;
		const when = this.options.when ?? (() => true);
		const { handler, onError } = this.options;

		let lastError: Error | undefined;
		const startTime = Date.now();

		const maxDurationMs = this.options.maxDuration
			? this.dateTimeProvider
					.duration(this.options.maxDuration)
					.asMilliseconds()
			: Infinity;

		// combine user-provided signal with the app's lifecycle signal
		const combinedSignal = this.options.signal;
		const onAbort = () => {
			if (!lastError) {
				lastError = new RetryCancelError();
			}
		};

		this.appAbortController.signal.addEventListener("abort", onAbort);
		combinedSignal?.addEventListener("abort", onAbort);

		try {
			for (let attempt = 1; attempt <= maxAttempts; attempt++) {
				if (this.appAbortController.signal.aborted || combinedSignal?.aborted) {
					throw new RetryCancelError();
				}

				if (Date.now() - startTime > maxDurationMs) {
					throw new RetryTimeoutError(maxDurationMs);
				}

				try {
					return await handler(...args);
				} catch (err) {
					lastError = err as Error;

					if (!(err instanceof Error) || !when(err)) {
						throw err; // don't retry if it's not an Error or `when` returns false
					}

					if (attempt >= maxAttempts) {
						break; // will throw lastError after the loop
					}

					if (onError) {
						onError(err, attempt, ...args);
					}

					// calculate and wait for backoff delay
					const delay = calculateBackoff(attempt, this.options.backoff);
					if (delay > 0) {
						await this.dateTimeProvider.wait(delay, { signal: combinedSignal });
					}
				}
			}
		} finally {
			// clean up listeners to prevent memory leaks
			this.appAbortController.signal.removeEventListener("abort", onAbort);
			combinedSignal?.removeEventListener("abort", onAbort);
		}

		throw lastError;
	}
}

export interface RetryDescriptorFn<T extends (...args: any[]) => any>
	extends RetryDescriptor<T> {
	(...args: Parameters<T>): Promise<ReturnType<T>>;
}

$retry[KIND] = RetryDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

function calculateBackoff(
	attempt: number,
	options?: number | RetryBackoffOptions,
): number {
	if (typeof options === "number") {
		return options;
	}

	const initial = options?.initial ?? 200;
	const factor = options?.factor ?? 2;
	const max = options?.max ?? 10000;
	const useJitter = options?.jitter !== false;

	const exponential = initial * factor ** (attempt - 1);
	let delay = Math.min(exponential, max);

	if (useJitter) {
		// Add a random amount of jitter (e.g., up to 50% of the delay)
		delay = delay * (1 + Math.random() * 0.5);
	}

	return Math.floor(delay);
}

// ---------------------------------------------------------------------------------------------------------------------

export interface RetryBackoffOptions {
	/**
	 * Initial delay in milliseconds.
	 *
	 * @default 200
	 */
	initial?: number;

	/**
	 * Multiplier for each subsequent delay.
	 *
	 * @default 2
	 */
	factor?: number;

	/**
	 * Maximum delay in milliseconds.
	 */
	max?: number;

	/**
	 * If true, adds a random jitter to the delay to prevent thundering herd.
	 *
	 * @default true
	 */
	jitter?: boolean;
}
