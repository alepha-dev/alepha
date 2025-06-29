import type { Alepha } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerCompressProvider } from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServerCompress {
	public readonly name = "alepha.server.compress";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(AlephaServer).with(ServerCompressProvider);
}
