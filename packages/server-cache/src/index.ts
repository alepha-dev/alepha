import { CacheModule } from "@alepha/cache";
import { $inject, Alepha } from "@alepha/core";
import { ServerModule } from "@alepha/server";
import { ServerCacheProvider } from "./providers/ServerCacheProvider.ts";

export * from "./providers/ServerCacheProvider.ts";

export class ServerCacheModule {
	protected readonly alepha = $inject(Alepha);
	constructor() {
		this.alepha.with(ServerModule);
		this.alepha.with(CacheModule);
		this.alepha.with(ServerCacheProvider);
	}
}
