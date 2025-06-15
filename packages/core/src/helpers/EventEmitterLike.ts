// ---------------------------------------------------------------------------------------------------------------------

/**
 * Low-cost event emitter like for internal use.
 * Used only for descriptor implicit registration.
 */
export class EventEmitterLike<TEvents extends { [key: string]: any }> {
	private hooks: {
		[key in keyof TEvents]?: ((data: TEvents[key]) => void)[];
	} = {};

	on<T extends keyof TEvents>(
		event: T,
		callback: (data: TEvents[T]) => void,
	): void {
		if (!this.hooks[event]) {
			this.hooks[event] = [];
		}

		this.hooks[event].push(callback);
	}

	emit<T extends keyof TEvents>(event: T, data: TEvents[T]): void {
		if (!this.hooks[event]) {
			return;
		}

		for (const callback of this.hooks[event]) {
			callback(data);
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------------
