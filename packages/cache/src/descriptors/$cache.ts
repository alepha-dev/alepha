import {
	$env,
	$inject,
	createDescriptor,
	Descriptor,
	type InstantiableClass,
	KIND,
	t,
} from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import { CacheError } from "../errors/CacheError.ts";
import { CacheProvider } from "../providers/CacheProvider.ts";
import { MemoryCacheProvider } from "../providers/MemoryCacheProvider.ts";

/**
 * Creates a cache storage or a cache function.
 */
export const $cache = <TReturn = string, TParameter extends any[] = any[]>(
	options: CacheDescriptorOptions<TReturn, TParameter> = {},
): CacheDescriptorFn<TReturn, TParameter> => {
	const instance = createDescriptor(
		CacheDescriptor<TReturn, TParameter>,
		options,
	);
	const fn = (...args: TParameter): Promise<TReturn> => instance.run(...args);
	return Object.setPrototypeOf(fn, instance) as CacheDescriptorFn<
		TReturn,
		TParameter
	>;
};

// ---------------------------------------------------------------------------------------------------------------------

export interface CacheDescriptorOptions<
	TReturn,
	TParameter extends any[] = any[],
> {
	/**
	 * The cache name. This is useful for invalidating multiple caches at once.
	 *
	 * Store key as `cache:$name:$key`.
	 *
	 * @default Name of the key of the class.
	 */
	name?: string;

	/**
	 * Function which returns cached data.
	 */
	handler?: (...args: TParameter) => TReturn;

	/**
	 * The key generator for the cache.
	 * If not provided, the arguments will be json.stringify().
	 */
	key?: (...args: TParameter) => string;

	/**
	 * The store provider for the cache.
	 * If not provided, the default store provider will be used.
	 */
	provider?: InstantiableClass<CacheProvider> | "memory";

	/**
	 * The time-to-live for the cache in seconds.
	 * Set 0 to skip expiration.
	 *
	 * @default 300 (5 minutes).
	 */
	ttl?: DurationLike;

	/**
	 * If the cache is disabled.
	 */
	disabled?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
	CACHE_ENABLED: t.boolean({ default: true }),
	CACHE_DEFAULT_TTL: t.number({
		default: 300, // 5 minutes
		description: "The default time to live for cache entries. In seconds.",
	}),
});

export class CacheDescriptor<
	TReturn = any,
	TParameter extends any[] = any[],
> extends Descriptor<CacheDescriptorOptions<TReturn, TParameter>> {
	protected readonly env = $env(envSchema);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly provider = this.$provider();
	protected encoder: TextEncoder = new TextEncoder();
	protected decoder: TextDecoder = new TextDecoder();
	protected codes = {
		BINARY: 0x01,
		JSON: 0x02,
		STRING: 0x03,
	};

	public get container(): string {
		return (
			this.options.name ??
			`${this.config.service.name}:${this.config.propertyKey}`
		);
	}

	public async run(...args: TParameter): Promise<TReturn> {
		const handler = this.options.handler;
		if (!handler) {
			throw new Error("Cache handler is not defined.");
		}

		const key = this.key(...args);
		const cached = await this.get(key);
		if (cached) {
			return cached;
		}

		const result = await handler(...args);
		// note: when exception occurs, don't cache the result

		await this.set(key, result);

		return result;
	}

	public key(...args: TParameter): string {
		return this.options.key ? this.options.key(...args) : JSON.stringify(args);
	}

	public async invalidate(...keys: string[]): Promise<void> {
		const keysToDelete: string[] = [];

		for (const key of keys) {
			if (key.endsWith("*")) {
				const result = await this.provider.keys(
					this.container,
					key.slice(0, -1),
				);
				keysToDelete.push(...result);
			} else {
				keysToDelete.push(key);
			}
		}

		await this.provider.del(this.container, ...keysToDelete);
	}

	public async set(
		key: string,
		value: TReturn,
		ttl?: DurationLike,
	): Promise<void> {
		const px = this.dateTimeProvider
			.duration(
				ttl ?? this.options.ttl ?? [this.env.CACHE_DEFAULT_TTL, "seconds"],
			)
			.as("milliseconds");

		await this.provider.set(
			this.container,
			key,
			this.serialize(value),
			px > 0 ? px : undefined,
		);
	}

	public async get(key: string): Promise<TReturn | undefined> {
		if (
			!this.alepha.isStarted() ||
			this.options.disabled ||
			!this.env.CACHE_ENABLED
		) {
			return undefined;
		}

		const data = await this.provider.get(this.container, key);
		if (data) {
			return await this.deserialize<TReturn>(data);
		}

		return undefined;
	}

	protected serialize<TReturn>(value: TReturn): Uint8Array {
		if (value instanceof Uint8Array) {
			return new Uint8Array([this.codes.BINARY, ...value]); // TODO: check if copy is ok?
		}

		if (typeof value === "string") {
			return new Uint8Array([this.codes.STRING, ...this.encoder.encode(value)]);
		}

		return new Uint8Array([
			this.codes.JSON,
			...this.encoder.encode(JSON.stringify(value)),
		]);
	}

	protected async deserialize<TReturn>(
		uint8Array: Uint8Array,
	): Promise<TReturn> {
		const type = uint8Array[0];
		const payload = uint8Array.slice(1);

		if (type === this.codes.BINARY) {
			return payload as TReturn;
		}
		if (type === this.codes.JSON) {
			return JSON.parse(this.decoder.decode(payload)) as TReturn;
		}
		if (type === this.codes.STRING) {
			return this.decoder.decode(payload) as TReturn;
		}

		throw new CacheError(`Unknown serialization type: ${type}`);
	}

	protected $provider(): CacheProvider {
		if (!this.options.provider) {
			return this.alepha.inject(CacheProvider);
		}

		if (this.options.provider === "memory") {
			return this.alepha.inject(MemoryCacheProvider);
		}

		return this.alepha.inject(this.options.provider);
	}
}

export interface CacheDescriptorFn<
	TReturn = any,
	TParameter extends any[] = any[],
> extends CacheDescriptor<TReturn, TParameter> {
	/**
	 * Run the cache descriptor with the provided arguments.
	 */
	(...args: TParameter): Promise<TReturn>;
}

$cache[KIND] = CacheDescriptor;
