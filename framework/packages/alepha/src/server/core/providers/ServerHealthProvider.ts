import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { HttpError } from "../errors/HttpError.ts";
import { $route } from "../primitives/$route.ts";
import { healthSchema } from "../schemas/healthSchema.ts";

/**
 * Registers `GET /health` and `GET /healthz`, and the two probes an
 * orchestrator asks for separately: `GET /livez` and `GET /readyz`.
 *
 * - `/health` and `/healthz` are readiness in practice: they answer 503 until
 *   the app is ready (`ServerNotReadyProvider`), 200 with `ready: true` after.
 * - `/livez` answers 200 as soon as the listener is bound, whatever the
 *   lifecycle: the process is alive. A liveness probe pointed at `/health`
 *   restarts a pod whose migrations are slow, in a loop.
 * - `/readyz` answers 503 until the app is ready, 200 after, and 503 again
 *   from the moment `stop()` begins (`Alepha.isStopping()`), so traffic moves
 *   away from an instance that is shutting down. Draining before the stop is
 *   the orchestrator's (a `preStop` wait): the framework adds no delay.
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
 * by the reverse proxy - see Bay's `internal/proxy` (`bay/` in this repository).
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

  /**
   * The path the not-ready gate lets through, since liveness must answer
   * while the app is still starting.
   */
  public static readonly LIVENESS_PATH = "/livez";

  public readonly livez = $route({
    path: ServerHealthProvider.LIVENESS_PATH,
    schema: {
      response: healthSchema,
    },
    silent: true,
    handler: () => this.healthCheck(),
  });

  public readonly readyz = $route({
    path: "/readyz",
    schema: {
      response: healthSchema,
    },
    silent: true,
    handler: ({ reply }) => {
      if (!this.alepha.isReady() || this.alepha.isStopping()) {
        reply.headers["Retry-After"] = "5";
        throw new HttpError(
          { status: 503 },
          {
            message: this.alepha.isStopping()
              ? "Server is stopping."
              : "Server is not ready yet. Please try again later.",
          },
        );
      }
      return this.healthCheck();
    },
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
