import { NotImplementedError } from "@alepha/core";

export class CacheProvider {
	constructor() {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Get the value of a key.
	 *
	 * @param group The group of the value to get.
	 * @param key The key of the value to get.
	 */
	public async get(group: string, key: string): Promise<string | undefined> {
		throw new NotImplementedError(this.constructor.name);
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
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Remove the specified keys.
	 *
	 * @param group The group of the value to get.
	 * @param keys The keys to delete.
	 */
	public async del(group: string, ...keys: string[]): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}
}
