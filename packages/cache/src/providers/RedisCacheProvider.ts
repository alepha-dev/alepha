import type { Static } from "@alepha/core";
import { $inject, $logger, t } from "@alepha/core";
import type { RedisClient } from "@alepha/redis";
import { RedisProvider } from "@alepha/redis";
import type { CacheProvider } from "./CacheProvider.ts";

const envSchema = t.object({
	REDIS_CACHE_PREFIX: t.optional(
		t.string({
			description: "Prefix store key",
		}),
	),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class RedisCacheProvider implements CacheProvider {
	protected readonly log = $logger();
	protected readonly redisProvider = $inject(RedisProvider);
	protected readonly env = $inject(envSchema);

	public get publisher(): RedisClient {
		return this.redisProvider.publisher;
	}

	/**
	 * Get the value of a key.
	 *
	 * @param group - The group of the value to get.
	 * @param key - The key of the value to get.
	 */
	public async get(group: string, key: string): Promise<string | undefined> {
		return (await this.publisher.get(this.prefix(group, key))) ?? undefined;
	}

	/**
	 * Set the string value of a key.
	 *
	 * @param group - The group of the value to get.
	 * @param key - The key of the value to set.
	 * @param value - The value to set.
	 * @param ttl - The time-to-live of the key, in milliseconds.
	 */
	public async set(
		group: string,
		key: string,
		value: string,
		ttl?: number,
	): Promise<string> {
		const prefix = this.prefix(group, key);

		if (ttl) {
			return this.publisher.set(prefix, value, "PX", ttl);
		}

		return this.publisher.set(prefix, value);
	}

	/**
	 * Remove the specified keys.
	 *
	 * @param group - The group of the value to get.
	 * @param keys - The keys to delete.
	 */
	public async del(group: string, ...keys: string[]): Promise<void> {
		const groupKey = this.prefix(group);

		if (keys.length === 0) {
			const keys = await this.publisher.keys(`${groupKey}:*`);
			await this.publisher.del(...keys);
			return;
		}

		await this.publisher.del(
			...keys.map((key) =>
				key.startsWith(groupKey) ? key : this.prefix(group, key),
			),
		);
	}

	/**
	 * Prefix the cache key.
	 *
	 * @param path - The path to prefix.
	 */
	protected prefix(...path: string[]) {
		const parts = ["cache", ...path];

		if (this.env.REDIS_CACHE_PREFIX) {
			parts.unshift(this.env.REDIS_CACHE_PREFIX);
		}

		return parts.join(":");
	}
}
