import {
	__descriptor,
	type AsyncFn,
	KIND,
	NotImplementedError,
	OPTIONS,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";

const KEY = "LOCK";

export interface LockDescriptorOptions<TFunc extends AsyncFn> {
	/**
	 * Function executed when the lock is acquired.
	 */
	handler: TFunc;

	/**
	 * If true, the handler will wait for the lock to be released.
	 *
	 * @default false
	 */
	wait?: boolean;

	key?: string | ((...args: Parameters<TFunc>) => string);

	maxDuration?: DurationLike;

	gracePeriod?: (...args: Parameters<TFunc>) => DurationLike | undefined;
}

export interface LockDescriptor<TFunc extends AsyncFn> {
	[KIND]: typeof KEY;
	[OPTIONS]: LockDescriptorOptions<TFunc>;

	/**
	 * Apply the lock.
	 *
	 * @param args
	 */
	(...args: Parameters<TFunc>): Promise<void>;
}

/**
 * Lock descriptor
 *
 * Make sure that only one instance of the handler is running at a time.
 *
 * When connected to a remote store, the lock is shared across all processes.
 *
 * @param options
 */
export const $lock: {
	<TFunc extends AsyncFn>(
		options: LockDescriptorOptions<TFunc>,
	): LockDescriptor<TFunc>;
	[KIND]: string;
} = <TFunc extends AsyncFn>(
	options: LockDescriptorOptions<TFunc>,
): LockDescriptor<TFunc> => {
	__descriptor(KEY);

	const $: LockDescriptor<TFunc> = (): Promise<void> => {
		throw new NotImplementedError(KEY);
	};

	$[KIND] = KEY;
	$[OPTIONS] = options;

	return $;
};

$lock[KIND] = KEY;
