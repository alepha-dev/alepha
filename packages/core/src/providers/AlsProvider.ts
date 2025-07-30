import type { AsyncLocalStorage } from "node:async_hooks";

export type AsyncLocalStorageData = any;

export class AlsProvider {
	static create = (): AsyncLocalStorage<AsyncLocalStorageData> | undefined => {
		return undefined;
	};

	protected als?: AsyncLocalStorage<AsyncLocalStorageData>;

	constructor() {
		this.als = AlsProvider.create();
	}

	public createContextId(): string {
		return crypto.randomUUID();
	}

	public run<R>(callback: () => R, data: Record<string, any> = {}): R {
		if (!this.als) {
			return callback();
		}

		data.context ??= this.createContextId();

		return this.als.run(data, callback);
	}

	public exists(): boolean {
		return !!this.get("context");
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

	public set<T>(key: string, value: T): void {
		if (!this.als) {
			return;
		}

		const store = this.als.getStore();
		if (store) {
			store[key] = value;
		}
	}
}
