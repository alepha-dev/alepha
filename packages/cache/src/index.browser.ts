import { $inject, Alepha, __bind } from "@alepha/core";
import { $cache } from "./descriptors/$cache.ts";
import { CacheDescriptorProvider } from "./providers/CacheDescriptorProvider.ts";
import { CacheProvider } from "./providers/CacheProvider.ts";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider.ts";

export * from "./descriptors/$cache.ts";
export * from "./providers/CacheDescriptorProvider.ts";
export * from "./providers/CacheProvider.ts";
export * from "./providers/MemoryCacheProvider.ts";

export class CacheModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register(CacheDescriptorProvider);
		this.alepha.register({
			provide: CacheProvider,
			use: MemoryCacheProvider,
		});
	}
}

__bind($cache, CacheModule);
