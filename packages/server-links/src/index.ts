import { __bind, type Alepha, type Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $remote } from "./descriptors/$remote.ts";
import { RemoteDescriptorProvider } from "./providers/RemoteDescriptorProvider.ts";
import { ServerLinksProvider } from "./providers/ServerLinksProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$client.ts";
export * from "./descriptors/$remote.ts";
export * from "./providers/LinkProvider.ts";
export * from "./providers/RemoteDescriptorProvider.ts";
export * from "./providers/ServerLinksProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServerLinks implements Module {
	public readonly name = "alepha.server.links";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer);
		alepha.with(ServerLinksProvider);
		alepha.with(RemoteDescriptorProvider);
	};
}

__bind($remote, AlephaServerLinks);
