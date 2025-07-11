import type { Alepha, Module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerMultipartProvider } from "./providers/ServerMultipartProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerMultipartProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Server Multipart Module
 *
 * This module provides support for handling multipart/form-data requests.
 * It allows to parse body data containing t.file().
 *
 * @see {@link ServerMultipartProvider}
 * @module alepha.server.multipart
 */
export class AlephaServerMultipart implements Module {
	public readonly name = "alepha.server.multipart";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer);
		alepha.with(ServerMultipartProvider);
	};
}
