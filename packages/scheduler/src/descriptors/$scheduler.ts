import {
	__descriptor,
	type Async,
	KIND,
	NotImplementedError,
	OPTIONS,
} from "@alepha/core";
import type { DateTime, DurationLike } from "@alepha/datetime";

const KEY = "SCHEDULER";

/**
 * Scheduler descriptor.
 */
export const $scheduler = (
	options: SchedulerDescriptorOptions,
): SchedulerDescriptor => {
	__descriptor(KEY);
	const $: SchedulerDescriptor = async () => {
		throw new NotImplementedError(KEY);
	};

	$[KIND] = KEY;
	$[OPTIONS] = options;

	return $;
};

$scheduler[KIND] = KEY;

export const isScheduler = (value: any): value is SchedulerDescriptor =>
	value && value[KIND] === KEY;

// ---------------------------------------------------------------------------------------------------------------------

export type SchedulerDescriptorOptions = {
	/**
	 * Function to run on schedule.
	 */
	handler: (args: SchedulerHandlerArguments) => Async<void>;

	/**
	 * Name of the scheduler. Defaults to the function name.
	 */
	name?: string;

	/**
	 * Optional description of the scheduler.
	 */
	description?: string;

	/**
	 * Cron expression or interval to run the scheduler.
	 */
	cron?: string;

	/**
	 * Cron expression or interval to run the scheduler.
	 */
	interval?: DurationLike;

	/**
	 * If true, the scheduler will be locked and only one instance will run at a time.
	 * You probably need to import {@link AlephaLockRedis} for distributed locking.
	 *
	 * @default true
	 */
	lock?: boolean;
};

export interface SchedulerDescriptor {
	[KIND]: typeof KEY;
	[OPTIONS]: SchedulerDescriptorOptions;
	(): Promise<void>;
}

export interface SchedulerHandlerArguments {
	now: DateTime;
}
