/**
 *
 */
export class Timeout {
	private timer: any = null;
	private duration: number;
	private readonly now: number;
	private readonly callback: () => void;

	constructor(now: number, duration: number, callback: () => void) {
		this.now = now;
		this.duration = duration;
		this.callback = callback;
		this.start();
	}

	/**
	 * Add time to the timeout.
	 */
	public add(amountMs: number) {
		if (this.timer == null) {
			return;
		}

		clearTimeout(this.timer);
		this.timer = null;

		const now = Date.now();
		const spent = now - this.now;
		this.duration = this.duration - spent - amountMs;

		if (this.duration <= 0) {
			this.callback();
		} else {
			this.start();
		}
	}

	/**
	 * Clear the timeout.
	 */
	public clear() {
		clearTimeout(this.timer);
		this.duration = 0;
		this.timer = null;
	}

	/**
	 * Start the timeout.
	 *
	 * @private
	 */
	private start() {
		this.timer = setTimeout(() => {
			this.callback();
		}, this.duration);
	}
}
