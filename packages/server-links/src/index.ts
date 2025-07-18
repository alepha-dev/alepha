import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $client } from "./descriptors/$client.ts";
import { $remote } from "./descriptors/$remote.ts";
import { LinkProvider } from "./providers/LinkProvider.ts";
import { RemoteDescriptorProvider } from "./providers/RemoteDescriptorProvider.ts";
import { ServerLinksProvider } from "./providers/ServerLinksProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$client.ts";
export * from "./descriptors/$remote.ts";
export * from "./providers/LinkProvider.ts";
export * from "./providers/RemoteDescriptorProvider.ts";
export * from "./providers/ServerLinksProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServerLinks = $module({
	name: "alepha.server.links",
	descriptors: [$remote, $client],
	services: [
		AlephaServer,
		ServerLinksProvider,
		RemoteDescriptorProvider,
		LinkProvider,
	],
});
