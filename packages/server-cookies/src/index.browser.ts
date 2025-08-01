import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$cookie";
export * from "./providers/ServerCookiesProvider";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServerCookies = $module({
	name: "alepha.server.cookies",
	descriptors: [],
	services: [AlephaServer],
});
