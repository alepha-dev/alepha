import { __bind, type Alepha, type Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $swagger } from "./descriptors/$swagger.ts";
import { ServerSwaggerProvider } from "./ServerSwaggerProvider.ts";

export * from "./descriptors/$swagger.ts";
export * from "./ServerSwaggerProvider.ts";

export class AlephaServerSwagger implements Module {
	public readonly name = "alepha.server.swagger";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(AlephaServer).with(ServerSwaggerProvider);
}

__bind($swagger, AlephaServerSwagger);
