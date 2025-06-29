import type { CacheProvider } from "@alepha/cache";
import { $inject, $logger, Alepha, type Static, t } from "@alepha/core";
import { RedisProvider } from "@alepha/redis";

const envSchema = t.object({
	REDIS_CACHE_PREFIX: t.optional(
		t.string({
			description:
				"Force a prefix for all cache keys in Redis. Useful for testing or multi-tenant applications.",
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
	protected readonly alepha = $inject(Alepha);

	public async get(name: string, key: string): Promise<Buffer | undefined> {
		if (!this.alepha.isReady()) {
			return;
		}

		return await this.redisProvider.get(this.prefix(name, key));
	}

	public async set(
		name: string,
		key: string,
		value: Buffer | string,
		ttl?: number,
	): Promise<Buffer> {
		if (!this.alepha.isReady()) {
			return Buffer.from(value);
		}

		const prefix = this.prefix(name, key);

		if (ttl) {
			return await this.redisProvider.set(prefix, value, {
				expiration: { type: "PX", value: ttl },
			});
		}

		return this.redisProvider.set(prefix, value);
	}

	public async del(name: string, ...keys: string[]): Promise<void> {
		const nameKey = this.prefix(name);

		if (keys.length === 0) {
			const keys = await this.redisProvider.keys(`${nameKey}:*`);
			await this.redisProvider.del(keys);
			return;
		}

		await this.redisProvider.del(
			keys.map((key) =>
				key.startsWith(nameKey) ? key : this.prefix(name, key),
			),
		);
	}

	public async has(name: string, key: string): Promise<boolean> {
		return this.get(name, key).then((value) => value != null);
	}

	public async keys(name: string): Promise<string[]> {
		return this.redisProvider.keys(`${this.prefix(name)}:*`);
	}

	protected prefix(...path: string[]) {
		const parts = ["cache", ...path];

		if (this.env.REDIS_CACHE_PREFIX) {
			parts.unshift(this.env.REDIS_CACHE_PREFIX);
		}

		return parts.join(":");
	}
}
