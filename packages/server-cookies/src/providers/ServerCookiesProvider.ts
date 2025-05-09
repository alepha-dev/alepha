import "@alepha/server"; // for hooks
import { $hook } from "@alepha/core";
import type { Cookie } from "../descriptors/$cookie.ts";

export class ServerCookiesProvider {
	public readonly onRequest = $hook({
		name: "server:onRequest",
		handler: async ({ request }) => {
			request.cookies = {
				req: this.fromHeader(request.headers.cookie),
				res: {},
			};
		},
	});

	public readonly onSend = $hook({
		name: "server:onSend",
		handler: async ({ request }) => {
			if (request.cookies) {
				if (Object.keys(request.cookies.res).length > 0) {
					request.reply.headers["set-cookie"] = this.toHeader(
						request.cookies.res,
					);
				}
			}
		},
	});

	public fromHeader(header: string): Record<string, string> {
		const cookies: Record<string, string> = {};
		const parts = header.split(";");
		for (const part of parts) {
			const [key, value] = part.split("=");
			if (!key || !value) {
				continue;
			}

			cookies[key.trim()] = value.trim();
		}

		return cookies;
	}

	public toHeader(cookies: Record<string, Cookie | null>): string[] {
		const headers = [];

		for (const [name, cookie] of Object.entries(cookies)) {
			const parts: string[] = [];

			// If the cookie is null, we need to delete it
			if (cookie == null) {
				parts.push(`${name}=; Path=/; Max-Age=0`);
				headers.push(parts.join("; "));
				continue;
			}

			if (!cookie.value) {
				continue;
			}

			parts.push(`${name}=${cookie.value}`);

			if (cookie.path) {
				parts.push(`Path=${cookie.path}`);
			}
			if (cookie.maxAge) {
				parts.push(`Max-Age=${cookie.maxAge}`);
			}
			if (cookie.secure) {
				parts.push("Secure");
			}
			if (cookie.httpOnly) {
				parts.push("HttpOnly");
			}
			if (cookie.sameSite) {
				parts.push(`SameSite=${cookie.sameSite}`);
			}
			if (cookie.domain) {
				parts.push(`Domain=${cookie.domain}`);
			}

			headers.push(parts.join("; "));
		}

		return headers;
	}
}
