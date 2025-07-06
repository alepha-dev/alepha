import { $hook, type HookDescriptor } from "@alepha/core";

export class ServerCorsProvider {
	public options: CorsOptions = {
		origin: "*",
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		headers: ["Content-Type", "Authorization"],
		credentials: true,
	};

	protected readonly onRequest: HookDescriptor<"server:onRequest"> = $hook({
		name: "server:onRequest",
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

			// Handle preflight
			if (request.method === "OPTIONS") {
				request.reply.setStatus(204);
			}
		},
	});

	public isOriginAllowed(
		origin: string | undefined,
		allowed: CorsOptions["origin"],
	): boolean {
		if (typeof allowed === "function") return allowed(origin);
		if (typeof allowed === "string") return origin === allowed;
		if (Array.isArray(allowed)) return allowed.includes(origin ?? "");
		return false;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export interface CorsOptions {
	origin?: string | string[] | ((origin: string | undefined) => boolean);
	methods: string[];
	headers: string[];
	credentials?: boolean;
	maxAge?: number;
}
