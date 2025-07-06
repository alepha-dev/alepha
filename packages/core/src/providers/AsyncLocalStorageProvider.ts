import type { AsyncLocalStorage } from "node:async_hooks";

export type AsyncLocalStorageData = any;

export class AsyncLocalStorageProvider {
	static create = (): AsyncLocalStorage<AsyncLocalStorageData> | undefined => {
		return undefined;
	};

	protected als?: AsyncLocalStorage<AsyncLocalStorageData>;

	constructor() {
		this.als = AsyncLocalStorageProvider.create();
	}

	public createContextId(): string {
		const t = Date.now().toString(36);
		const r = Math.random().toString(36).slice(2, 8);

		let id = "";
		for (let i = 0; i < 10; i++) {
			id += (i % 2 === 0 ? t : r)[Math.floor(i / 2)] || "";
		}

		return (
			"r" +
			id
				.split("")
				.sort(() => 0.5 - Math.random())
				.join("")
		);
	}

	public run<R>(callback: () => R, data: Record<string, any> = {}) {
		if (!this.als) {
			return callback();
		}

		return this.als.run(
			{
				context: this.createContextId(),
				...data,
			},
			callback,
		);
	}

	public get<T>(key: string): T | undefined {
		if (!this.als) {
			return undefined;
		}

		const store = this.als.getStore();

		if (store) {
			return store[key] as T;
		}

		return undefined;
	}

	public set<T>(key: string, value: T) {
		if (!this.als) {
			return;
		}

		const store = this.als.getStore();

		if (store) {
			store[key] = value;
		}
	}
}
