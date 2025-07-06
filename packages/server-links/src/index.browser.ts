import { __bind, type Alepha, type Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $remote } from "./descriptors/$remote.ts";
import { LinkProvider } from "./providers/LinkProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$client.ts";
export * from "./descriptors/$remote.ts";
export * from "./providers/LinkProvider.ts";

// ---------------------------------------------------------------- -----------------------------------------------------

export class AlephaServerLinks implements Module {
	public readonly name = "alepha.server.links";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer);
		alepha.with(LinkProvider);
	};
}

__bind($remote, AlephaServerLinks);
