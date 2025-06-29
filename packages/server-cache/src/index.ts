import { AlephaCache } from "@alepha/cache";
import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerCacheProvider } from "./providers/ServerCacheProvider.ts";

export * from "./providers/ServerCacheProvider.ts";

export class AlephaServerCache implements Module {
	public readonly name = "alepha.server.cache";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(AlephaServer).with(AlephaCache).with(ServerCacheProvider);
}
