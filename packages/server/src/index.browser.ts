import { $module } from "@alepha/core";
import { HttpClient } from "./services/HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServer = $module({
	name: "alepha.server",
	descriptors: [],
	services: [HttpClient],
});
