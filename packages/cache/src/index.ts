import type { Static } from "@alepha/core";
import { $inject, Alepha, __bind, t } from "@alepha/core";
import { $cache } from "./descriptors/$cache.ts";
import { CacheDescriptorProvider } from "./providers/CacheDescriptorProvider.ts";
import { CacheProvider } from "./providers/CacheProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";
import { RedisCacheProvider } from "./providers/RedisCacheProvider.ts";

export * from "./descriptors/$cache.ts";
export * from "./providers/CacheDescriptorProvider.ts";
export * from "./providers/CacheProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";
export * from "./providers/RedisCacheProvider.ts";

const envSchema = t.object({
	CACHE_PROVIDER: t.enum(["memory", "redis", "sqlite"], {
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
			provide: CacheProvider,
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
