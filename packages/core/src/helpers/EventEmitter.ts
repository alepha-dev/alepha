import type { Async } from "../interfaces/Async.ts";

export interface EventEmitterItem<T extends object> {
	name: keyof T;
	handler: (arg: any) => Async<void>;
}

export class EventEmitter<T extends object> {
	protected events: EventEmitterItem<T>[] = [];

	/**
	 *
	 * @param name
	 * @param handler
	 */
	public on<Key extends keyof T>(
		name: Key,
		handler: (arg: T[Key]) => void,
	): () => void {
		this.events.push({ handler, name });
		return () => {
			this.events = this.events.filter((it) => it.handler !== handler);
		};
	}

	/**
	 *
	 * @param name
	 * @param data
	 */
	public async emit<Key extends keyof T>(
		name: Key,
		data: T[Key],
	): Promise<void> {
		await Promise.all(
			this.events
				.filter((it) => it.name === name)
				.map((it) => it.handler(data)),
		);
	}
}
