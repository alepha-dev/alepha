import type { CacheProvider } from "@alepha/cache";
import {
	$inject,
	$logger,
	Alepha,
	type Logger,
	type Static,
	type TObject,
	type TOptional,
	type TString,
	t,
} from "@alepha/core";
import { RedisProvider } from "@alepha/redis";

const envSchema: TObject<{
	REDIS_CACHE_PREFIX: TOptional<TString>;
}> = t.object({
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
	protected readonly log: Logger = $logger();
	protected readonly redisProvider: RedisProvider = $inject(RedisProvider);
	protected readonly env: Static<typeof envSchema> = $inject(envSchema);
	protected readonly alepha: Alepha = $inject(Alepha);

	public async get(name: string, key: string): Promise<Uint8Array | undefined> {
		if (!this.alepha.isStarted()) {
			return;
		}

		const buffer = await this.redisProvider.get(this.prefix(name, key));
		if (!buffer) {
			return;
		}

		this.log.debug(`Cache hit for ${name}:${key}`, { size: buffer.byteLength });
		return new Uint8Array(buffer);
	}

	public async set(
		name: string,
		key: string,
		value: Uint8Array | string,
		ttl?: number,
	): Promise<Uint8Array> {
		if (!this.alepha.isReady()) {
			return new Uint8Array(Buffer.from(value));
		}

		const buffer = Buffer.from(value);
		const prefix = this.prefix(name, key);

		if (ttl) {
			return new Uint8Array(
				await this.redisProvider.set(prefix, buffer, {
					expiration: { type: "PX", value: ttl },
				}),
			);
		}

		return new Uint8Array(await this.redisProvider.set(prefix, buffer));
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

	protected prefix(...path: string[]): string {
		const parts = ["cache", ...path];

		if (this.env.REDIS_CACHE_PREFIX) {
			parts.unshift(this.env.REDIS_CACHE_PREFIX);
		}

		return parts.join(":");
	}
}
