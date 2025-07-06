import { __bind, type Alepha, type Module } from "@alepha/core";
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

export class AlephaServerCookies implements Module {
	public readonly name = "alepha.server.cookies";
	public readonly $services = (alepha: Alepha): void => {
		alepha.with(AlephaServer).with(ServerCookiesProvider);
	};
}

__bind($cookie, AlephaServerCookies);
