import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $route } from "alepha/server";
import { healthSchema } from "../schemas/healthSchema.ts";

/**
 * Register `/health` & `/healthz` endpoint.
 *
 * - Provides basic health information about the server.
 */
export class ServerHealthProvider {
  protected readonly time: DateTimeProvider = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  public readonly health = $route({
    path: "/health",
    schema: {
      response: healthSchema,
    },
    silent: true,
    handler: () => this.healthCheck(),
  });

  public readonly healthz = $route({
    path: "/healthz",
    schema: {
      response: healthSchema,
    },
    silent: true,
    handler: () => this.healthCheck(),
  });

  protected healthCheck() {
    return {
      message: "OK",
      uptime: Math.floor(process.uptime()),
      date: this.time.nowISOString(),
      ready: this.alepha.isReady(),
    };
  }
}
