import type { Static } from "@alepha/core";
import { $inject, Alepha, autoInject, t } from "@alepha/core";
import { $cache } from "./descriptors/$cache";
import { CacheDescriptorProvider } from "./providers/CacheDescriptorProvider";
import { CacheProvider } from "./providers/CacheProvider";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider";
import { RedisCacheProvider } from "./providers/RedisCacheProvider";

export * from "./descriptors/$cache";
export * from "./providers/CacheDescriptorProvider";
export * from "./providers/CacheProvider";
export * from "./providers/MemoryCacheProvider";
export * from "./providers/RedisCacheProvider";

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
		this.alepha.register(CacheDescriptorProvider);
		this.alepha.register({
			default: true,
			provide: CacheProvider,
			use: {
				memory: MemoryCacheProvider,
				sqlite: MemoryCacheProvider, // TODO
				redis: RedisCacheProvider,
			}[this.env.CACHE_PROVIDER],
		});
	}
}

autoInject($cache, CacheModule);
