import { $inject, $logger, type Logger } from "@alepha/core";
import { DateTimeProvider, type Timeout } from "@alepha/datetime";
import type { CacheProvider } from "./CacheProvider.ts";

type CacheName = string;
type CacheKey = string;
type CacheValue = {
	data?: Uint8Array;
	timeout?: Timeout;
};

export class MemoryCacheProvider implements CacheProvider {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly log = $logger();

	protected store: Record<CacheName, Record<CacheKey, CacheValue>> = {};

	public async get(name: string, key: string): Promise<Uint8Array | undefined> {
		return this.store[name]?.[key]?.data;
	}

	public async set(
		name: string,
		key: string,
		value: Uint8Array,
		ttl?: number,
	): Promise<Uint8Array> {
		if (this.store[name] == null) {
			this.store[name] = {};
		}

		this.store[name][key] ??= {};
		this.store[name][key].data = value;

		this.log.debug(`Setting cache for name`, { name, key, ttl });

		// clear previous timeout if exists
		if (this.store[name][key].timeout) {
			this.store[name][key].timeout.clear();
			this.store[name][key].timeout = undefined;
		}

		if (ttl) {
			this.store[name][key].timeout = this.dateTimeProvider.timeout(
				() => this.del(name, key),
				ttl,
			);
		}

		return this.store[name][key].data;
	}

	public async del(name: string, ...keys: string[]): Promise<void> {
		// delete all keys in name
		if (keys.length === 0) {
			this.log.debug(`Deleting all cache for name`, { name });

			if (this.store[name]) {
				for (const key of Object.keys(this.store[name])) {
					this.store[name][key]?.timeout?.clear();
				}
			}
			delete this.store[name];
			return;
		}

		this.log.debug(`Deleting cache for name`, { name, keys });

		// delete specific keys in name
		for (const key of keys) {
			if (this.store[name] == null) break;

			this.store[name][key]?.timeout?.clear();
			delete this.store[name][key];
		}

		if (Object.keys(this.store[name] ?? {}).length === 0) {
			// if name is empty, delete it
			delete this.store[name];
		}
	}

	public async has(name: string, key: string): Promise<boolean> {
		return this.store[name]?.[key]?.data != null;
	}

	public async keys(name: string): Promise<string[]> {
		return Object.keys(this.store[name] ?? {});
	}
}
