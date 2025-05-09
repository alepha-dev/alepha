import { $hook, $inject, $logger, Alepha } from "@alepha/core";

export class ServerLoggerProvider {
	protected readonly log = $logger("Server");
	protected readonly alepha = $inject(Alepha);

	public readonly onRequest = $hook({
		name: "server:onRequest",
		priority: "first",
		handler: ({ route, request }) => {
			if (!route.silent) {
				const req = request.raw.node?.req;

				request.metadata.now = Date.now();

				const data: Record<string, string> = {
					method: request.method,
					path: request.url.pathname,
				};

				if (this.alepha.isProduction()) {
					data.agent = request.headers["user-agent"];
					const ip = req
						? request.headers["x-forwarded-for"]?.split(",")[0] ||
							req.socket.remoteAddress
						: undefined;
					if (ip) {
						data.ip = ip;
					}
				}

				this.log.info("Incoming request", data);
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
