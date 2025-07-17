import { __descriptor, $cursor, type Async, KIND } from "@alepha/core";
import type { Interval } from "../helpers/Interval.ts";
import {
	DateTimeProvider,
	type DurationLike,
} from "../providers/DateTimeProvider.ts";

/**
 * Registers a new interval.
 */
export const $interval: {
	(options: IntervalDescriptorOptions): Interval;
	[KIND]: string;
} = (options: IntervalDescriptorOptions): Interval => {
	__descriptor("INTERVAL");

	const { context } = $cursor();
	const dt = context.get(DateTimeProvider);

	return dt.interval({
		attach: true,
		run: false,
		...options,
	});
};

export interface IntervalDescriptorOptions {
	/**
	 * Whether to start the interval immediately.
	 *
	 * @default false
	 */
	run?: boolean;

	/**
	 * Whether to attach the interval to the context.
	 *
	 * Attached intervals are automatically started when the context starts and stopped when the context stops.
	 *
	 * @default true
	 */
	attach?: boolean;

	/**
	 * The interval handler.
	 */
	handler: () => Async<void>;

	/**
	 * The interval duration.
	 */
	duration: DurationLike;
}

$interval[KIND] = "INTERVAL";
