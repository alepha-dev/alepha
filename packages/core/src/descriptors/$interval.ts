import type { DurationLike } from "luxon";
import type { Async } from "../interfaces/Async";
import { DateTimeProvider } from "../providers/DateTimeProvider";
import { $cursor } from "./$cursor";

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

/**
 * Registers a new interval.
 */
export const $interval = (options: IntervalDescriptorOptions) => {
	const { context } = $cursor();
	const dt = context.get(DateTimeProvider);

	return dt.interval({
		attach: true,
		run: false,
		...options,
	});
};
