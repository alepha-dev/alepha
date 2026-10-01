import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { $route } from "../primitives/$route.ts";
import { healthSchema } from "../schemas/healthSchema.ts";

/**
 * Registers `GET /health` and `GET /healthz`.
 *
 * Part of `AlephaServer` rather than opt-in, because the thing that consumes it
 * cannot ask for it. A supervisor starting an app has no way to know whether
 * that app chose to expose a readiness endpoint, so it is left with a TCP dial,
 * and a process binds its port before it has run its migrations. An app is
 * therefore declared ready while it is still setting up its database, and gets
 * traffic it cannot serve. Making this universal is what lets a supervisor
 * distinguish "listening" from "working".
 *
 * `ready` is the only load-bearing field: it follows the container's lifecycle,
 * so it is false for exactly as long as the app is still starting.
 *
 * Not a security concern to have on by default: it says nothing an unauthorized
 * caller can use, and both this and `/metrics` are masked from the public host
 * by the reverse proxy - see `apps/bay/internal/proxy`.
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
