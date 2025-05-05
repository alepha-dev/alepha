import type { Timeout } from "@alepha/core";
import { $inject, $logger, DateTimeProvider } from "@alepha/core";
import type { CacheProvider } from "./CacheProvider.ts";

/**
 * A simple in-memory store provider.
 */
export class MemoryCacheProvider implements CacheProvider {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly log = $logger();

	/**
	 * The in-memory store.
	 */
	protected store: Record<string, Record<string, string>> = {};

	/**
	 * Timeouts used to expire keys.
	 */
	protected storeTimeout: Record<string, Record<string, Timeout>> = {};

	/**
	 * Get the value of a key.
	 *
	 * @param group The group of the value to get.
	 * @param key The key of the value to get.
	 */
	public async get(group: string, key: string): Promise<string | undefined> {
		return this.store[group]?.[key];
	}

	/**
	 * Set the string value of a key.
	 *
	 * @param group The group of the value to get.
	 * @param key The key of the value to set.
	 * @param value The value to set.
	 * @param ttl The time-to-live of the key, in milliseconds.
	 */
	public async set(
		group: string,
		key: string,
		value: string,
		ttl?: number,
	): Promise<string> {
		if (ttl) {
			this.ttl(group, key, ttl);
		}

		if (this.store[group] == null) {
			this.store[group] = {};
		}

		this.store[group][key] = value;

		return this.store[group][key];
	}

	/**
	 * Remove the specified keys.
	 *
	 * @param group The group of the value to get.
	 * @param keys The keys to delete.
	 */
	public async del(group: string, ...keys: string[]): Promise<void> {
		if (keys.length === 0) {
			delete this.store[group];

			if (this.storeTimeout[group] != null) {
				for (const timeout of Object.values(this.storeTimeout[group])) {
					timeout.clear();
				}
			}

			delete this.storeTimeout[group];

			return;
		}

		for (const key of keys) {
			if (this.store[group] == null) break;

			delete this.store[group][key];

			const timeout = this.storeTimeout[group]?.[key];
			if (timeout) {
				timeout.clear();
				delete this.storeTimeout[group][key];
			}
		}
	}

	private ttl(group: string, key: string, ms: number): void {
		if (this.storeTimeout[group]?.[key]) {
			this.storeTimeout[group][key].clear();
			delete this.storeTimeout[group][key];
		}

		this.storeTimeout[group] ??= {};
		this.storeTimeout[group][key] = this.dateTimeProvider.timeout(() => {
			delete this.store[group]?.[key];
			delete this.storeTimeout[group]?.[key];
		}, ms);
	}
}
