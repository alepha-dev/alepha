import { NotImplementedError } from "@alepha/core";

/**
 * Store Provider Interface
 */
export class LockProvider {
	constructor() {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Set the string value of a key.
	 *
	 * @param key The key of the value to set.
	 * @param value The value to set.
	 * @param nx If set to true, the key will only be set if it does not already exist.
	 * @param px Set the specified expire time, in milliseconds.
	 */
	public async set(
		_key: string,
		_value: string,
		_nx?: boolean,
		_px?: number,
	): Promise<string> {
		throw new NotImplementedError(this.constructor.name);
	}

	/**
	 * Remove the specified keys.
	 *
	 * @param keys The keys to delete.
	 */
	public async del(..._keys: string[]): Promise<void> {
		throw new NotImplementedError(this.constructor.name);
	}
}
