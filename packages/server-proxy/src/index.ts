import { __bind, type Alepha, type Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $proxy } from "./descriptors/$proxy.ts";
import { ProxyDescriptorProvider } from "./providers/ProxyDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$proxy.ts";
export * from "./providers/ProxyDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServerProxy implements Module {
	public readonly name = "alepha.server.proxy";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer);
		alepha.with(ProxyDescriptorProvider);
	};
}

__bind($proxy, AlephaServerProxy);
