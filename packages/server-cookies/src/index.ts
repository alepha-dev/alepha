import { __bind } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $cookie, type Cookies } from "./descriptors/$cookie.ts";
import { ServerCookiesProvider } from "./providers/ServerCookiesProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$cookie";
export * from "./providers/ServerCookiesProvider";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/server" {
	interface ServerRequest {
		cookies: Cookies;
	}
}

export class AlephaServerCookies {
	public readonly name = "alepha.server.cookies";
	public readonly $services = (alepha: any) => {
		alepha.with(AlephaServer).with(ServerCookiesProvider);
	};
}

__bind($cookie, AlephaServerCookies);
