import { $hook, $inject, Alepha } from "alepha";

import { HttpError } from "../errors/HttpError.ts";
import { ServerHealthProvider } from "./ServerHealthProvider.ts";

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
    on: "server:request:before",
    priority: "first",
    handler: ({ request: { reply, url } }) => {
      if (this.alepha.isReady()) {
        return;
      }
      // Liveness answers whatever the lifecycle: a liveness probe sent a 503
      // while migrations run would restart the pod in a loop.
      if (url.pathname === ServerHealthProvider.LIVENESS_PATH) {
        return;
      }

      reply.headers["Retry-After"] = "5"; // Retry after 5 seconds

      throw new HttpError(
        { status: 503 },
        { message: "Server is not ready yet. Please try again later." },
      );
    },
  });
}
