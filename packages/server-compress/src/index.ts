import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerCompressProvider } from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServerCompress implements Module {
	public readonly name = "alepha.server.compress";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer).with(ServerCompressProvider);
	};
}
