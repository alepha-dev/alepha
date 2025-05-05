import type { DurationLike, DurationLikeObject } from "luxon";
import { DateTime, Duration } from "luxon";
import { $hook } from "../descriptors/$hook.ts";
import type { IntervalDescriptorOptions } from "../descriptors/$interval.ts";
import { $logger } from "../descriptors/$logger.ts";
import { Interval } from "../helpers/Interval.ts";
import { Timeout } from "../helpers/Timeout.ts";

export { DateTime, Duration } from "luxon";
export type { DurationLike } from "luxon";

export class DateTimeProvider {
	protected log = $logger();
	protected ref: DateTime | null = null;
	protected readonly timeouts: Timeout[] = [];
	protected readonly intervals: Interval[] = [];

	protected readonly start = $hook({
		name: "start",
		handler: async () => {
			for (const interval of this.intervals) {
				await interval.start();
			}
		},
	});

	protected readonly stop = $hook({
		name: "stop",
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
	 *
	 * @param date
	 */
	public of(date: Date | string | DateTime): DateTime<true> {
		if (date instanceof DateTime) {
			return date;
		}

		if (date instanceof Date) {
			return DateTime.fromJSDate(date) as DateTime<true>;
		}

		return DateTime.fromISO(date) as DateTime<true>;
	}

	/**
	 * Get the current date.
	 */
	public now(): DateTime<true> {
		return this.of(this.getCurrentDate());
	}

	/**
	 * Get the current date as a string.
	 *
	 * @param date
	 */
	public toISOString(date: Date | string | DateTime = this.now()): string {
		return this.of(date).toISO()!;
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
	protected getCurrentDate(): DateTime<true> {
		if (this.ref) {
			return this.ref;
		}

		return DateTime.now();
	}

	/**
	 * Create a new Duration instance.
	 *
	 * @param duration
	 */
	public duration(duration: DurationLike | string): Duration {
		if (typeof duration === "number") {
			return Duration.fromMillis(duration);
		}
		if (typeof duration === "string") {
			return Duration.fromISO(duration);
		}
		if (duration instanceof Duration) {
			return duration;
		}
		return Duration.fromObject(duration);
	}

	// Testing

	/**
	 * Add time to the current date.
	 */
	public async add(duration: DurationLikeObject): Promise<void> {
		this.ref = this.ref || this.now();
		this.ref = this.ref.plus(duration);
		const ms = Duration.fromObject(duration).as("milliseconds");

		for (const timeout of this.timeouts) {
			timeout.add(ms);
		}

		for (const interval of this.intervals) {
			await interval.add(ms);
		}

		await this.tick();
	}

	/**
	 * Return a promise that resolves after a next tick.
	 * It uses `setTimeout` with 0ms delay.
	 */
	public async tick() {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	/**
	 * Stop the time.
	 */
	public pause() {
		this.ref = this.ref || this.now();
		return this.ref;
	}

	/**
	 * Reset the reference date.
	 */
	public reset() {
		this.ref = null;
	}

	/**
	 * Wait for a certain duration.
	 *
	 * @param duration
	 * @param signal
	 */
	public wait(duration: DurationLike, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve) => {
			let clearTimeout: any;
			let callback: any;
			const timeout = this.timeout(() => {
				if (signal && clearTimeout) {
					signal.removeEventListener("abort", callback);
				}
				resolve();
			}, this.duration(duration));

			if (signal) {
				clearTimeout = () => timeout.clear();
				callback = () => {
					clearTimeout();
					resolve();
				};
				signal.addEventListener("abort", callback);
			}
		});
	}

	/**
	 * Run a callback after a certain duration.
	 *
	 * @param callback
	 * @param duration
	 */
	public timeout(callback: () => void, duration: DurationLike): Timeout {
		const timeout = new Timeout(
			this.now().valueOf(),
			this.duration(duration).as("milliseconds"),
			callback,
		);

		this.timeouts.push(timeout);

		return timeout;
	}

	/**
	 * Create an interval.
	 *
	 * @param args
	 */
	public interval(args: IntervalDescriptorOptions): Interval {
		const ms = this.duration(args.duration).as("milliseconds");
		const interval = new Interval(ms, args);

		if (args.attach) {
			this.intervals.push(interval);
		}

		if (args.run) {
			interval.start().catch((error) => {
				this.log.error(error);
			});
		}

		return interval;
	}

	/**
	 * Run a function with a deadline.
	 *
	 * @param fn
	 * @param duration
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
}
