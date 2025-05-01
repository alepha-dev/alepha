/// <reference types="vite/client" />
import type { AsyncLocalStorage } from "node:async_hooks";

export type AsyncLocalStorageData = any;

export class AsyncLocalStorageProvider {
	protected als?: AsyncLocalStorage<AsyncLocalStorageData>;

	public async configure() {
		if (import.meta.env?.SSR !== false) {
			const { AsyncLocalStorage } = await import("node:async_hooks");
			this.als = new AsyncLocalStorage<AsyncLocalStorageData>();
		}
	}

	public run<R>(data: AsyncLocalStorageData, callback: () => R) {
		if (!this.als) {
			return callback();
		}

		return this.als.run(data, callback);
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
