import { $module } from "@alepha/core";
import { $action } from "./descriptors/$action.ts";
import { HttpClient } from "./services/HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServer = $module({
	name: "alepha.server",
	descriptors: [$action],
	services: [HttpClient],
});
