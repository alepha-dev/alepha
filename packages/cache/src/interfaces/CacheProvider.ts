export interface CacheProvider {
	/**
	 * Get the value of a key.
	 *
	 * @param group The group of the value to get.
	 * @param key The key of the value to get.
	 */
	get(group: string, key: string): Promise<string | undefined>;

	/**
	 * Set the string value of a key.
	 *
	 * @param group The group of the value to get.
	 * @param key The key of the value to set.
	 * @param value The value to set.
	 * @param ttl The time-to-live of the key, in milliseconds.
	 */
	set(group: string, key: string, value: string, ttl?: number): Promise<string>;

	/**
	 * Remove the specified keys.
	 *
	 * @param group The group of the value to get.
	 * @param keys The keys to delete.
	 */
	del(group: string, ...keys: string[]): Promise<void>;
}
