import { $module } from "@alepha/core";
import { $client } from "./descriptors/$client.ts";
import { $remote } from "./descriptors/$remote.ts";
import { LinkProvider } from "./providers/LinkProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$client.ts";
export * from "./descriptors/$remote.ts";
export * from "./providers/LinkProvider.ts";

// ---------------------------------------------------------------- -----------------------------------------------------

export const AlephaServerLinks = $module({
	name: "alepha.server.links",
	descriptors: [$remote, $client],
	services: [LinkProvider],
});
