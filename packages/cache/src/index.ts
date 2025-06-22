import type { Static } from "@alepha/core";
import { __bind, $inject, Alepha, t } from "@alepha/core";
import { $cache } from "./descriptors/$cache.ts";
import { CacheDescriptorProvider } from "./providers/CacheDescriptorProvider.ts";
import { DefaultCacheProvider } from "./providers/DefaultCacheProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";
import { RedisCacheProvider } from "./providers/RedisCacheProvider.ts";

export * from "./descriptors/$cache.ts";
export * from "./interfaces/CacheProvider.ts";
export * from "./providers/CacheDescriptorProvider.ts";
export * from "./providers/DefaultCacheProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";
export * from "./providers/RedisCacheProvider.ts";

const envSchema = t.object({
	CACHE_PROVIDER: t.enum(["memory", "redis"], {
		default: "memory",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class CacheModule {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);

	constructor() {
		this.alepha.register({
			provide: DefaultCacheProvider,
			use: {
				memory: MemoryCacheProvider,
				sqlite: MemoryCacheProvider, // TODO
				redis: RedisCacheProvider,
			}[this.env.CACHE_PROVIDER],
		});
		this.alepha.register(CacheDescriptorProvider);
	}
}

__bind($cache, CacheModule);
