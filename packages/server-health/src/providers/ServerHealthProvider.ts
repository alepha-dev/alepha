import { $inject, Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $route } from "@alepha/server";

/**
 * Register `/health` endpoint.
 *
 * - Provides basic health information about the server.
 */
export class ServerHealthProvider {
  protected readonly time: DateTimeProvider = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  public readonly health = $route({
    path: "/health",
    schema: {
      response: t.object({
        message: t.text(),
        uptime: t.number(),
        date: t.datetime(),
        ready: t.boolean(),
      }),
    },
    silent: true,
    handler: () => ({
      message: "OK",
      uptime: Math.floor(process.uptime()),
      date: this.time.nowISOString(),
      ready: this.alepha.isReady(),
    }),
  });
}
