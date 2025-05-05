import { $inject, $logger } from "@alepha/core";
import type { RedisClient } from "@alepha/redis";
import { RedisProvider } from "@alepha/redis";
import { LockProvider } from "./LockProvider.ts";

/**
 * A store provider that uses Redis.
 */
export class RedisLockProvider extends LockProvider {
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
		const args: (string | number)[] = [key, value];

		if (px) {
			args.push("PX", px);
		}

		if (nx) {
			args.push("NX");
		}

		args.push("GET");

		return (
			(await this.publisher.set(
				...(args as Parameters<typeof this.publisher.set>),
			)) ?? value
		);
	}

	/**
	 * Remove the specified keys.
	 *
	 * @param keys The keys to delete.
	 */
	public async del(...keys: string[]): Promise<void> {
		await this.publisher.del(...keys);
	}
}
