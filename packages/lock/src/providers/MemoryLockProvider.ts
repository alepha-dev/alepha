import { $inject, $logger } from "@alepha/core";
import { DateTimeProvider, type Timeout } from "@alepha/datetime";
import type { LockProvider } from "./LockProvider.ts";

/**
 * A simple in-memory store provider.
 */
export class MemoryLockProvider implements LockProvider {
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly log = $logger();

	/**
	 * The in-memory store.
	 */
	protected store: Record<string, string> = {};

	/**
	 * Timeouts used to expire keys.
	 */
	protected storeTimeout: Record<string, Timeout> = {};

	/**
	 * Set the string value of a key.
	 *
	 * @param key The key of the value to set.
	 * @param value The value to set.
	 * @param nx If set to true, the key will only be set if it does not already exist.
	 * @param px Set the specified expire time, in milliseconds.
	 */
	public async set(
		key: string,
		value: string,
		nx?: boolean,
		px?: number,
	): Promise<string> {
		if (nx && this.store[key] != null) {
			return this.store[key];
		}

		if (px) {
			this.ttl(key, px);
		}

		this.store[key] = value;

		return this.store[key];
	}

	/**
	 * Remove the specified keys.
	 *
	 * @param keys The keys to delete.
	 */
	public async del(...keys: string[]): Promise<void> {
		for (const key of keys) {
			delete this.store[key];
			if (this.storeTimeout[key] != null) {
				this.storeTimeout[key].clear();
				delete this.storeTimeout[key];
			}
		}
	}

	/**
	 * Set a timeout for a key.
	 *
	 * @param key The key to set the timeout for.
	 * @param ms The number of milliseconds to wait before deleting the key.
	 */
	private ttl(key: string, ms: number): void {
		if (this.storeTimeout[key] != null) {
			this.storeTimeout[key].clear();
			delete this.storeTimeout[key];
		}

		this.storeTimeout[key] = this.dateTimeProvider.timeout(() => {
			delete this.store[key];
			delete this.storeTimeout[key];
		}, ms);
	}
}
