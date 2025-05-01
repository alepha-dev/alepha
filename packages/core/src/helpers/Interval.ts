import type { IntervalDescriptorOptions } from "../descriptors/$interval";

export class Interval {
	private timer: any = null;
	private readonly run: () => Promise<void>;

	constructor(
		private duration: number,
		private options: IntervalDescriptorOptions,
	) {
		this.run = async () => {
			try {
				await this.options.handler();
			} catch (error) {
				console.error(error);
			}
		};
	}

	/**
	 * Start the interval.
	 */
	public async start() {
		if (this.timer != null) {
			return;
		}

		await this.run();

		this.timer = setInterval(this.run, this.duration);
	}

	/**
	 * Add time to the interval.
	 *
	 * @param amountMs
	 */
	public async add(amountMs: number) {
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
	public clear() {
		clearInterval(this.timer);
		this.duration = 0;
		this.timer = null;
	}
}
