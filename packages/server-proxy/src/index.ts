import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $proxy } from "./descriptors/$proxy.ts";
import { ProxyDescriptorProvider } from "./providers/ProxyDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$proxy.ts";
export * from "./providers/ProxyDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServerProxy = $module({
	name: "alepha.server.proxy",
	descriptors: [$proxy],
	services: [AlephaServer, ProxyDescriptorProvider],
});
