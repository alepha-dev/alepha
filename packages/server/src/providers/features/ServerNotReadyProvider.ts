import { $hook, $inject, Alepha } from "@alepha/core";

/**
 * On every request, this provider checks if the server is ready.
 *
 * If the server is not ready, it responds with a 503 status code and a message indicating that the server is not ready yet.
 *
 * The response also includes a `Retry-After` header indicating that the client should retry after 5 seconds.
 */
export class ServerNotReadyProvider {
	protected readonly alepha = $inject(Alepha);

	public readonly onRequest = $hook({
		name: "server:onRequest",
		priority: "first",
		handler: ({ request: { reply } }) => {
			if (this.alepha.isReady()) {
				return;
			}

			reply.status = 503;
			reply.body = "Server is not ready yet. Please try again later.";
			reply.headers["Retry-After"] = "5"; // Retry after 5 seconds
			reply.headers["Content-Type"] = "text/plain";
		},
	});
}
