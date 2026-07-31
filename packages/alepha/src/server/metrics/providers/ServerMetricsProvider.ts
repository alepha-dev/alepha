import { $env, $hook, $inject, Alepha, z } from "alepha";
import { $logger } from "alepha/logger";
import { $route, HttpError } from "alepha/server";
import { collectDefaultMetrics, Histogram, Registry } from "prom-client";

export class ServerMetricsProvider {
  protected readonly register: Registry = new Registry();
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly env = $env(
    z.object({
      /**
       * Bearer token protecting the `/metrics` endpoint. When set, requests
       * must carry `Authorization: Bearer <token>`. Without it the endpoint
       * is public — set this in any internet-facing production deployment.
       */
      METRICS_TOKEN: z.string().optional(),
    }),
  );
  protected httpRequestDuration?: Histogram<string>;

  public readonly options: ServerMetricsProviderOptions = {};

  public readonly metrics = $route({
    method: "GET",
    path: "/metrics",
    silent: true,
    handler: ({ headers }) => {
      const token = this.env.METRICS_TOKEN;
      if (token && headers.authorization !== `Bearer ${token}`) {
        throw new HttpError({ status: 401, message: "Unauthorized" });
      }
      return this.register.metrics();
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      if (
        this.alepha.isProduction() &&
        !this.env.METRICS_TOKEN &&
        !this.isLoopbackOnly()
      ) {
        this.log.warn(
          "/metrics is reachable from the network without authentication — set METRICS_TOKEN, or bind SERVER_HOST to loopback and put a proxy in front.",
        );
      }
      collectDefaultMetrics({
        register: this.register,
        ...this.options,
      });
      this.httpRequestDuration = new Histogram({
        name: "http_request_duration_seconds",
        help: "Duration of HTTP requests in seconds",
        labelNames: ["method", "path", "code"],
        registers: [this.register],
      });
    },
  });

  /**
   * Reports whether the server only accepts connections from this machine.
   *
   * The warning above is about being reachable, not about being unauthenticated
   * — and an app bound to loopback is not reachable. That is the normal shape
   * behind a reverse proxy, where the proxy decides what the internet may see;
   * a self-hosted supervisor typically refuses `/metrics` on the public host
   * outright.
   *
   * Warning there anyway is worse than saying nothing. It fires on every boot
   * of every correctly-configured app, and a warning that is usually wrong is
   * how people learn to skip warnings — including the one time it is right,
   * which is `SERVER_HOST=0.0.0.0` with no token.
   */
  protected isLoopbackOnly(): boolean {
    const host = String(this.alepha.env.SERVER_HOST ?? "").trim();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]"
    );
  }

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    priority: "first",
    handler: ({ request }) => {
      const end = this.httpRequestDuration?.startTimer();
      request.metadata.metricsTimer = end;
    },
  });

  protected readonly onResponse = $hook({
    on: "server:onResponse",
    priority: "last",
    handler: ({ request, response, route }) => {
      const timerEnd = request.metadata.metricsTimer as
        | MetricsTimerEnd
        | undefined;

      if (timerEnd) {
        timerEnd({
          method: request.method,
          path: route.path,
          code: response.status,
        });
      }
    },
  });
}

export interface ServerMetricsProviderOptions {
  prefix?: string;
  gcDurationBuckets?: number[];
  eventLoopMonitoringPrecision?: number;
  labels?: object;
}

type MetricsTimerEnd = (labels?: Record<string, string | number>) => number;
