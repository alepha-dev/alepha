import { $inject, Alepha, autoInject } from "@alepha/core";
import { $cache } from "./descriptors/$cache";
import { CacheDescriptorProvider } from "./providers/CacheDescriptorProvider";
import { CacheProvider } from "./providers/CacheProvider";
import { MemoryCacheProvider } from "./providers/MemoryCacheProvider";

export * from "./descriptors/$cache";
export * from "./providers/CacheDescriptorProvider";
export * from "./providers/CacheProvider";
export * from "./providers/MemoryCacheProvider";

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

autoInject($cache, CacheModule);
