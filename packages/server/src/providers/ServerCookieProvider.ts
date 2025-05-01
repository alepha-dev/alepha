import { $hook } from "@alepha/core";
import { CookieManager } from "../helpers/CookieManager.ts";

export class ServerCookieProvider {
	protected readonly onRequest = $hook({
		name: "server:onRequest",
		handler: async ({ request }) => {
			request.cookies = new CookieManager(request.headers.get("cookie"));
		},
	});

	protected readonly onSend = $hook({
		name: "server:onSend",
		handler: async ({ request }) => {
			if (request.cookies) {
				if (Object.keys(request.cookies.res).length > 0) {
					request.headers.set("Set-Cookie", request.cookies.toHeader());
				}
			}
		},
	});
}
