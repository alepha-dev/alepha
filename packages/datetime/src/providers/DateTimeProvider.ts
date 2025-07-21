import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import dayjs, { type Dayjs, type ManipulateType } from "dayjs";
import dayjsDuration from "dayjs/plugin/duration.js";
import dayjsRelativeTime from "dayjs/plugin/relativeTime.js";
import {
	$interval,
	type IntervalDescriptor,
} from "../descriptors/$interval.ts";
import { Timeout } from "../helpers/Timeout.ts";

export type DateTimeApi = typeof dayjs;
export type DateTime = dayjs.Dayjs;
export type Duration = dayjsDuration.Duration;
export type DurationLike =
	| number
	| dayjsDuration.Duration
	| [number, ManipulateType];

export class DateTimeProvider {
	protected alepha = $inject(Alepha);
	protected log = $logger();
	protected ref: DateTime | null = null;
	protected readonly timeouts: Timeout[] = [];

	public get intervals(): IntervalDescriptor[] {
		return this.alepha.descriptors($interval);
	}

	constructor() {
		this.plugins(dayjs);
	}

	/**
	 * Load Day.js plugins.
	 *
	 * You can override this method to add custom plugins.
	 */
	protected plugins(api: DateTimeApi): void {
		api.extend(dayjsDuration);
		api.extend(dayjsRelativeTime);
	}

	protected readonly start = $hook({
		on: "start",
		handler: async () => {
			await Promise.all(
				this.intervals
					.filter((interval) => interval.options.run === "start")
					.map((interval) => interval.start()),
			);
		},
	});

	protected readonly ready = $hook({
		priority: "last",
		on: "ready",
		handler: async () => {
			await Promise.all(
				this.intervals
					.filter((interval) => interval.options.run === "ready")
					.map((interval) => interval.start()),
			);
		},
	});

	protected readonly stop = $hook({
		on: "stop",
		handler: () => {
			for (const timeout of this.timeouts) {
				timeout.clear();
			}

			for (const interval of this.intervals) {
				interval.clear();
			}
		},
	});

	/**
	 * Create a new DateTime instance.
	 */
	public of(date: string | number | Date | Dayjs | null | undefined): DateTime {
		return dayjs(date);
	}

	/**
	 * Get the current date.
	 */
	public now(): DateTime {
		return this.of(this.getCurrentDate());
	}

	/**
	 * Get the current date as a string.
	 *
	 * @param date
	 */
	public toISOString(date: Date | string | DateTime = this.now()): string {
		return this.of(date).toISOString();
	}

	/**
	 * Get the current date as a string.
	 */
	public nowISOString(): string {
		return this.toISOString();
	}

	/**
	 * Get the current date as a string.
	 *
	 * @protected
	 */
	protected getCurrentDate(): DateTime {
		if (this.ref) {
			return this.ref;
		}

		return dayjs();
	}

	/**
	 * Create a new Duration instance.
	 */
	public duration = (
		duration: DurationLike,
		unit?: ManipulateType,
	): Duration => {
		if (Array.isArray(duration)) {
			return dayjs.duration(duration[0], duration[1]);
		}
		if (typeof duration === "number") {
			return dayjs.duration(duration, unit || "milliseconds");
		}
		return duration;
	};

	public isDurationLike(value: unknown): value is DurationLike {
		return dayjs.isDuration(this.duration(value as DurationLike));
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Return a promise that resolves after a next tick.
	 * It uses `setTimeout` with 0ms delay.
	 */
	public async tick(): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	/**
	 * Wait for a certain duration.
	 *
	 * You can clear the timeout by using the `AbortSignal` API.
	 * Aborted signal will resolve the promise immediately, it does not reject it.
	 */
	public wait(
		duration: DurationLike,
		options: {
			signal?: AbortSignal;
			now?: number;
		} = {},
	): Promise<void> {
		return new Promise((resolve) => {
			let clearTimeout: any;
			let callback: any;

			const timeout = this.timeout(
				() => {
					if (options.signal && clearTimeout) {
						options.signal.removeEventListener("abort", callback);
					}
					resolve();
				},
				duration,
				options.now,
			);

			if (options.signal) {
				clearTimeout = () => timeout.clear();
				callback = () => {
					clearTimeout();
					resolve();
				};
				options.signal.addEventListener("abort", callback);
			}
		});
	}

	/**
	 * Run a callback after a certain duration.
	 */
	public timeout(
		callback: () => void,
		duration: DurationLike,
		now?: number,
	): Timeout {
		if (this.ref && now) {
			const next = this.of(now).add(this.duration(duration));
			if (next < this.now()) {
				callback();
			}
			return new Timeout(now, 0, () => {});
		}

		const timeout = new Timeout(
			now ?? this.now().valueOf(),
			this.duration(duration).asMilliseconds(),
			callback,
		);

		this.timeouts.push(timeout);

		return timeout;
	}

	/**
	 * Run a function with a deadline.
	 */
	public async deadline<T>(
		fn: (signal: AbortSignal) => Promise<T>,
		duration: DurationLike,
	): Promise<T> {
		const abort = new AbortController();
		const timeout = this.timeout(() => abort.abort(), duration);
		try {
			return await fn(abort.signal);
		} finally {
			timeout.clear();
		}
	}

	// -------------------------------------------------------------------------------------------------------------------

	// Testing

	/**
	 * Add time to the current date.
	 */
	public async travel(
		duration: DurationLike,
		unit?: ManipulateType,
	): Promise<void> {
		this.ref = this.ref || this.now();
		this.ref = this.ref.add(this.duration(duration, unit));
		const ms = this.duration(duration, unit).asMilliseconds();

		for (const timeout of this.timeouts) {
			timeout.add(ms);
		}

		for (const interval of this.intervals) {
			await interval.add(ms);
		}

		await this.tick();
	}

	/**
	 * Stop the time.
	 */
	public pause(): DateTime {
		this.ref = this.ref || this.now();
		return this.ref;
	}

	/**
	 * Reset the reference date.
	 */
	public reset(): void {
		this.ref = null;
	}
}
