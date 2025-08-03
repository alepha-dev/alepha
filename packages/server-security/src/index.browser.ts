import { $module } from "@alepha/core";
import { AlephaSecurity } from "@alepha/security";
import { AlephaServer } from "@alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServerSecurity = $module({
	name: "alepha.server.security",
	services: [AlephaServer, AlephaSecurity],
});
