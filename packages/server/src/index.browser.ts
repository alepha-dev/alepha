import type { Alepha, Module } from "@alepha/core";
import { HttpClient } from "./services/HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class AlephaServer implements Module {
	public readonly name = "alepha.server";
	public readonly $services = (alepha: Alepha) => {
		alepha.with(HttpClient);
	};
}
