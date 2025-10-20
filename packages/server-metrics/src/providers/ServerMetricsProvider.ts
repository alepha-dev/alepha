import { $hook, $inject, Alepha } from "@alepha/core";
import { $route } from "@alepha/server";
import { collectDefaultMetrics, Histogram, Registry } from "prom-client";

export class ServerMetricsProvider {
  protected readonly register: Registry = new Registry();
  protected readonly alepha = $inject(Alepha);
  protected httpRequestDuration?: Histogram<string>;

  public readonly options: ServerMetricsProviderOptions = {};

  public readonly metrics = $route({
    method: "GET",
    path: "/metrics",
    silent: true,
    handler: () => this.register.metrics(),
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
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
