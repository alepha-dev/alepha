import { $hook, $inject } from "@alepha/core";
import { ServerRouterProvider } from "@alepha/server";

export class ServerCorsProvider {
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);

	public options: ServerCorsProviderOptions = {
		origin: "*",
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		headers: ["Content-Type", "Authorization"],
		credentials: true,
	};

	protected readonly onRoute = $hook({
		on: "server:onRoute",
		handler: async ({ route }) => {
			if (
				!route.method ||
				route.method === "GET" ||
				route.method === "OPTIONS"
			) {
				return;
			}

			await this.serverRouterProvider.createRoute({
				path: route.path,
				method: "OPTIONS",
				handler: ({ reply }) => {
					reply.setStatus(204);
				},
			});
		},
	});

	protected readonly onRequest = $hook({
		on: "server:onRequest",
		handler: ({ request }) => {
			const reqOrigin = request.headers.origin;
			const { origin, methods, headers, credentials, maxAge } = this.options;

			if (reqOrigin && this.isOriginAllowed(reqOrigin, origin)) {
				request.reply.setHeader("Access-Control-Allow-Origin", reqOrigin);
			}

			if (credentials) {
				request.reply.setHeader("Access-Control-Allow-Credentials", "true");
			}

			request.reply.setHeader(
				"Access-Control-Allow-Methods",
				methods.join(", "),
			);
			request.reply.setHeader(
				"Access-Control-Allow-Headers",
				headers.join(", "),
			);

			if (maxAge != null) {
				request.reply.setHeader("Access-Control-Max-Age", String(maxAge));
			}
		},
	});

	public isOriginAllowed(
		origin: string | undefined,
		allowed: ServerCorsProviderOptions["origin"],
	): boolean {
		if (allowed === "*") return true;
		if (typeof allowed === "function") return allowed(origin);
		if (typeof allowed === "string") return origin === allowed;
		if (Array.isArray(allowed)) return allowed.includes(origin ?? "");
		return false;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export interface ServerCorsProviderOptions {
	origin?: string | string[] | ((origin: string | undefined) => boolean);
	methods: string[];
	headers: string[];
	credentials?: boolean;
	maxAge?: number;
}
