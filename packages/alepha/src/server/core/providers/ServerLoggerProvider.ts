import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

export class ServerLoggerProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  public readonly onRequest = $hook({
    on: "server:onRequest",
    priority: "first",
    handler: ({ route, request }) => {
      if (route.silent || request.metadata.vite) {
        return;
      }

      request.metadata.now = this.dateTime.nowMillis();

      const search = request.url.search;
      const data: Record<string, string> = {
        method: request.method,
        path: search
          ? `${request.url.pathname}${search}`
          : request.url.pathname,
      };

      if (this.alepha.isProduction()) {
        data.agent = request.headers["user-agent"];
        const ip = request.ip;
        if (ip) {
          data.ip = ip;
        }
      }

      this.log.info("Incoming request", data);
    },
  });

  public readonly onError = $hook({
    on: "server:onError",
    priority: "last",
    handler: ({ error }) => {
      this.log.error("Request has failed", error);
    },
  });

  public readonly onResponse = $hook({
    on: "server:onResponse",
    priority: "last",
    handler: ({ route, request, response }) => {
      if (route.silent || request.metadata.vite) {
        return;
      }

      const ms = this.dateTime.nowMillis() - request.metadata.now;
      const search = request.url.search;
      this.log.info("Request completed", {
        method: request.method,
        path: search
          ? `${request.url.pathname}${search}`
          : request.url.pathname,
        status: response.status,
        duration: ms,
      });
    },
  });
}
