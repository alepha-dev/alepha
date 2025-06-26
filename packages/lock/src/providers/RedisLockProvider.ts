import { $inject, $logger } from "@alepha/core";
import {
	type RedisClient,
	RedisProvider,
	type RedisSetOptions,
} from "@alepha/redis";
import type { LockProvider } from "./LockProvider.ts";

/**
 * A store provider that uses Redis.
 */
export class RedisLockProvider implements LockProvider {
	protected readonly log = $logger();
	protected readonly redisProvider = $inject(RedisProvider);

	/**
	 * Get the Redis publisher.
	 */
	protected get publisher(): RedisClient {
		return this.redisProvider.publisher;
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
		key: string,
		value: string,
		nx?: boolean,
		px?: number,
	): Promise<string> {
		const options: RedisSetOptions = {
			GET: true, // all the secrets of $lock is based on this
		};

		if (px) {
			options.expiration = {
				type: "PX",
				value: px,
			};
		}

		if (nx) {
			options.condition = "NX";
		}

		return ((await this.publisher.set(key, value, options)) ?? value) as string;
	}

	/**
	 * Remove the specified keys.
	 */
	public async del(...keys: string[]): Promise<void> {
		await this.publisher.del(keys);
	}
}
