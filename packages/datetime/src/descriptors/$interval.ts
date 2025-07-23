import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import {
	DateTimeProvider,
	type DurationLike,
} from "../providers/DateTimeProvider.ts";

/**
 * Run a function periodically.
 * It uses the `setInterval` internally.
 * It starts by default when the context starts and stops when the context stops.
 */
export const $interval = (options: IntervalDescriptorOptions) =>
	createDescriptor(IntervalDescriptor, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface IntervalDescriptorOptions {
	/**
	 * The interval handler.
	 */
	handler: () => unknown;

	/**
	 * The interval duration.
	 */
	duration: DurationLike;
}

// ---------------------------------------------------------------------------------------------------------------------

export class IntervalDescriptor extends Descriptor<IntervalDescriptorOptions> {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);

	public called = 0;

	protected onInit() {
		this.dateTimeProvider.createInterval(async () => {
			await this.options.handler();
			this.called += 1;
		}, this.options.duration);
	}
}

$interval[KIND] = IntervalDescriptor;
