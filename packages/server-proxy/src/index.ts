import { $inject, Alepha, __bind } from "@alepha/core";
import { ServerModule } from "@alepha/server";
import { $proxy } from "./descriptors/$proxy.ts";
import { ServerProxyProvider } from "./providers/ServerProxyProvider.ts";

export * from "./descriptors/$proxy.ts";
export * from "./providers/ServerProxyProvider.ts";

export class ServerProxyModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with(ServerModule);
		this.alepha.with(ServerProxyProvider);
	}
}

__bind($proxy, ServerProxyModule);
