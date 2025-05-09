import { $hook, $logger } from "@alepha/core";

export class ServerLoggerProvider {
	protected readonly log = $logger("Server");

	public readonly onRequest = $hook({
		name: "server:onRequest",
		priority: "first",
		handler: ({ route, request }) => {
			if (!route.silent) {
				const req = request.raw.node?.req;

				const ip = req
					? request.headers["x-forwarded-for"]?.split(",")[0] ||
						req.socket.remoteAddress
					: undefined;

				request.metadata.now = Date.now();

				this.log.info("Incoming request", {
					method: request.method,
					path: request.url.pathname,
					agent: request.headers["user-agent"],
					ip: ip,
				});
			}
		},
	});

	public readonly onError = $hook({
		name: "server:onError",
		priority: "last",
		handler: ({ route, error }) => {
			if (!route.silent) {
				this.log.error("Request has failed", error);
			}
		},
	});

	public readonly onResponse = $hook({
		name: "server:onResponse",
		priority: "last",
		handler: ({ route, request, response }) => {
			if (!route.silent) {
				const ms = Date.now() - request.metadata.now;
				this.log.info("Request completed", { status: response.status, ms });
			}
		},
	});
}
