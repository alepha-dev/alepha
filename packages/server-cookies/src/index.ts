import { __bind } from "@alepha/core";
import { $cookie, type Cookies } from "./descriptors/$cookie.ts";
import { ServerCookiesProvider } from "./providers/ServerCookiesProvider.ts";

declare module "@alepha/server" {
	interface ServerRequest {
		cookies: Cookies;
	}
}

export * from "./providers/ServerCookiesProvider";
export * from "./descriptors/$cookie";

__bind($cookie, ServerCookiesProvider);
