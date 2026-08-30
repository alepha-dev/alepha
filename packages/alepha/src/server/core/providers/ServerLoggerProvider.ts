import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { HttpError } from "../errors/HttpError.ts";
import { LogRedaction } from "../services/LogRedaction.ts";

export class ServerLoggerProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly redaction = $inject(LogRedaction);

  /**
   * The request path as it should appear in a log line: unchanged when it
   * carries nothing sensitive, and with credential values replaced
   * otherwise.
   *
   * The request path is logged at info level, so an OAuth callback wrote its
   * `code` and `state` straight into production logs - a live authorization
   * code, sitting in whatever the log ships to.
   *
   * The key list used to live here. It moved to {@link LogRedaction} when
   * `HttpClient` turned out to need the same one for its own URLs and
   * bodies, and two copies of a security vocabulary drift.
   */
  protected loggedPath(url: URL): string {
    return this.redaction.path(url);
  }

  public readonly onRequest = $hook({
    on: "server:onRequest",
    priority: "first",
    handler: ({ route, request }) => {
      if (route.silent || request.metadata.vite) {
        return;
      }

      request.metadata.now = this.dateTime.nowMillis();

      const data: Record<string, string> = {
        method: request.method,
        path: this.loggedPath(request.url),
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
      // An expected 4xx is the server working correctly: a missing
      // session, a role the caller lacks, a malformed body. Logging
      // those at `error` with a stack buries genuine faults — on a
      // public app the error channel becomes almost entirely
      // unauthenticated traffic, and any alerting on it is worthless.
      //
      // 5xx and anything without a status stay at `error`.
      const status = HttpError.is(error) ? error.status : undefined;
      if (status && status >= 400 && status < 500) {
        this.log.debug("Request rejected", {
          status,
          message: error.message,
        });
        return;
      }

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
      this.log.info("Request completed", {
        method: request.method,
        path: this.loggedPath(request.url),
        status: response.status,
        duration: ms,
      });
    },
  });
}
