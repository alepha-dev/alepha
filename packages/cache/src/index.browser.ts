import { __bind, $inject, Alepha } from "@alepha/core";
import { $cache } from "./descriptors/$cache.ts";
import { CacheDescriptorProvider } from "./providers/CacheDescriptorProvider.ts";
import { DefaultCacheProvider } from "./providers/DefaultCacheProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";

export * from "./descriptors/$cache.ts";
export * from "./providers/CacheDescriptorProvider.ts";
export * from "./providers/DefaultCacheProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";

export class CacheModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register({
			provide: DefaultCacheProvider,
			use: MemoryCacheProvider,
		});

		this.alepha.register(CacheDescriptorProvider);
	}
}

__bind($cache, CacheModule);
