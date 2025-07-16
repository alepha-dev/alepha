import { __bind, type Alepha } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $serve } from "./descriptors/$serve.ts";
import { ServerStaticProvider } from "./providers/ServerStaticProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$serve.ts";
export * from "./providers/ServerStaticProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Create static file server with `$static()`.
 *
 * @see {@link ServerStaticProvider}
 * @module alepha.server.static
 */
export class AlephaServerStatic {
	public readonly name = "alepha.server.static";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer).with(ServerStaticProvider);
	};
}

__bind($serve, AlephaServerStatic);
