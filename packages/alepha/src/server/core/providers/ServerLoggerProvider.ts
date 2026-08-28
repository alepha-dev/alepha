import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { HttpError } from "../errors/HttpError.ts";

export class ServerLoggerProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  /**
   * Query parameters whose VALUE never reaches a log line.
   *
   * The request path is logged at info level, so an OAuth callback wrote its
   * `code` and `state` straight into production logs - a live authorization
   * code, sitting in whatever the log ships to. The key is kept, because
   * knowing which parameters a request carried is most of what the line is
   * for; only the value goes.
   */
  protected readonly redactedQueryKeys = new Set([
    "code",
    "state",
    "token",
    "access_token",
    "refresh_token",
    "key",
  ]);

  /**
   * The request path as it should appear in a log line: unchanged when it
   * carries nothing sensitive, and with the values of {@link
   * redactedQueryKeys} replaced otherwise.
   */
  protected loggedPath(url: URL): string {
    const { pathname, search, searchParams } = url;
    if (!search) {
      return pathname;
    }
    // The common case rebuilds nothing, so a request with an ordinary query
    // is logged byte for byte as it arrived.
    let sensitive = false;
    for (const key of searchParams.keys()) {
      if (this.redactedQueryKeys.has(key.toLowerCase())) {
        sensitive = true;
        break;
      }
    }
    if (!sensitive) {
      return `${pathname}${search}`;
    }

    const parts: string[] = [];
    for (const [key, value] of searchParams) {
      parts.push(
        this.redactedQueryKeys.has(key.toLowerCase())
          ? `${encodeURIComponent(key)}=[redacted]`
          : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      );
    }
    return `${pathname}?${parts.join("&")}`;
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
