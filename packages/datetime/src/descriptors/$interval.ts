import {
	type Async,
	createFactory,
	Descriptor,
	type DescriptorArgs,
} from "@alepha/core";
import {
	DateTimeProvider,
	type DurationLike,
} from "../providers/DateTimeProvider.ts";

export interface IntervalDescriptorOptions {
	/**
	 * When to run the interval handler.
	 * - "now": Run immediately when the interval is registered.
	 * - "start": Run when the context starts.
	 * - "ready": Run when the context is ready (after all services are started).
	 *
	 * @default "start"
	 */
	run?: "now" | "start" | "ready";

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

export class IntervalDescriptor extends Descriptor<IntervalDescriptorOptions> {
	protected timer: any = null;
	protected duration: number;
	protected readonly run: () => Promise<void>;

	public called = 0;

	constructor(args: DescriptorArgs<IntervalDescriptorOptions>) {
		super(args);
		this.options.attach ??= true;
		this.options.run ??= "start";
		this.duration = this.alepha
			.get(DateTimeProvider)
			.duration(args.options.duration)
			.asMilliseconds();

		this.run = async () => {
			try {
				await this.options.handler();
				this.called += 1;
			} catch (error) {
				console.error(error);
			}
		};

		if (this.options.run === "now") {
			this.run();
		}
	}

	/**
	 * Start the interval.
	 */
	public async start(): Promise<void> {
		if (this.timer != null) {
			return;
		}

		await this.run();

		this.timer = setInterval(this.run, this.duration);
	}

	/**
	 * Add time to the interval. For test purposes only.
	 */
	public async add(amountMs: number): Promise<void> {
		if (this.timer == null) {
			return;
		}

		clearInterval(this.timer);
		this.timer = null;

		const repeat = Math.floor(amountMs / this.duration);
		for (let i = 0; i < repeat; i++) {
			await this.run();
		}
	}

	/**
	 * Clear the interval.
	 */
	public clear(): void {
		clearInterval(this.timer);
		this.duration = 0;
		this.timer = null;
	}
}

/**
 * Run a function periodically.
 * It uses the `setInterval` internally.
 * It starts by default when the context starts and stops when the context stops.
 */
export const $interval = createFactory(IntervalDescriptor);
