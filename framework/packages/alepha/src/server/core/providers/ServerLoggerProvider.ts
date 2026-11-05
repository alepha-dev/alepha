import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { isHttpError } from "../errors/HttpError.ts";
import type { ServerRequest } from "../interfaces/ServerRequest.ts";
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

  /**
   * {@link loggedPath} of a request, taken from the request line as Node
   * received it when that gives the same text, so a Node request that
   * nothing else asks the URL of never parses one (about 440 ns).
   *
   * The same text means: no character `URL` would percent-encode, no dot
   * segment it would resolve, no leading `//`. Anything else, and every Web
   * request, goes through the parsed URL as before.
   */
  protected requestPath(request: ServerRequest): string {
    const raw = request.raw.node?.req.url;
    if (
      raw === undefined ||
      !ServerLoggerProvider.PLAIN_TARGET.test(raw) ||
      ServerLoggerProvider.DOT_SEGMENT.test(raw)
    ) {
      return this.loggedPath(request.url);
    }
    const mark = raw.indexOf("?");
    if (mark < 0) {
      return raw;
    }
    // `url.search` is empty for a bare trailing `?`: the pathname alone.
    if (mark === raw.length - 1) {
      return raw.slice(0, mark);
    }
    return raw.slice(0, mark) + this.redaction.query(raw.slice(mark));
  }

  /**
   * A path and query `URL` leaves as they are: a path of unreserved, sub-delim,
   * `:`, `@`, `%` and `/` characters not starting with `//`, then a query of
   * the same plus `?`. Every character `URL` encodes in either (space, `"`,
   * `#`, `<`, `>`, `'`, backtick, braces, `^`, `|`, `\`, non-ASCII) is left
   * out, so a target holding one is parsed instead.
   */
  protected static readonly PLAIN_TARGET =
    /^\/(?!\/)[A-Za-z0-9\-._~!$&()*+,;=:@%/]*(\?[A-Za-z0-9\-._~!$&()*+,;=:@%/?]*)?$/;

  /**
   * A `.` or `..` segment, or an encoded dot, which `URL` resolves.
   */
  protected static readonly DOT_SEGMENT = /\/\.|%2e/i;

  public readonly onRequest = $hook({
    on: "server:request:before",
    priority: "first",
    handler: ({ route, request }) => {
      if (route.silent || request.metadata.vite) {
        return;
      }

      request.metadata.now = this.dateTime.nowMillis();
      // Kept for `Request completed`, which logs the same path.
      request.metadata.loggedPath = this.requestPath(request);

      // At debug: `Request completed` carries everything this line did, so
      // at info a request was two lines saying the same thing, and the log
      // write was the largest cost of a hello-world request (one line instead
      // of two answered 17% more requests a second). A request that never
      // completes is still visible with `LOG_LEVEL=debug`.
      this.log.debug("Incoming request", {
        method: request.method,
        path: request.metadata.loggedPath,
      });
    },
  });

  public readonly onError = $hook({
    on: "server:request:error",
    priority: "last",
    handler: ({ error }) => {
      // An expected 4xx is the server working correctly: a missing
      // session, a role the caller lacks, a malformed body. Logging
      // those at `error` with a stack buries genuine faults — on a
      // public app the error channel becomes almost entirely
      // unauthenticated traffic, and any alerting on it is worthless.
      //
      // 5xx and anything without a status stay at `error`.
      const status = isHttpError(error) ? error.status : undefined;
      if (status && status >= 400 && status < 500) {
        // ⚠️ A 403 is the one refusal whose reason exists nowhere else.
        //
        // The client is handed a `requestId` and an "Access denied" page, and
        // that id is the only handle it has: the whole point of printing it is
        // that a developer can look up which rule fired. At `debug` this line
        // does not leave a production deployment, so the id led to a single
        // `Request completed` carrying a status and nothing else. A false
        // denial was therefore undiagnosable after the fact: the guard that
        // refused, and what it wanted, were never written down anywhere.
        //
        // So it rises to `warn`, which production ships, while staying off the
        // `error` channel for the reason above. The volume is bounded in a way
        // the other 4xx are not: a 403 requires a resolved identity, so
        // anonymous traffic cannot produce one. A 401 and a 404 can, and both
        // say all they have to say in the status itself, so they stay quiet.
        const level = status === 403 ? "warn" : "debug";

        this.log[level]("Request rejected", {
          status,
          // The error's name, not just the message: `FORBIDDEN` and `SECURITY`
          // are raised by different layers and read alike once flattened to a
          // string.
          error: error.name,
          message: error.message,
        });
        return;
      }

      this.log.error("Request has failed", error);
    },
  });

  public readonly onResponse = $hook({
    on: "server:response:after",
    priority: "last",
    handler: ({ route, request, response }) => {
      if (route.silent || request.metadata.vite) {
        return;
      }

      const data: Record<string, string | number> = {
        method: request.method,
        path: request.metadata.loggedPath ?? this.requestPath(request),
        status: response.status,
        duration: this.dateTime.nowMillis() - request.metadata.now,
      };

      if (this.alepha.isProduction()) {
        const agent = request.headers["user-agent"];
        if (agent) {
          data.agent = agent;
        }
        const ip = request.ip;
        if (ip) {
          data.ip = ip;
        }
      }

      this.log.info("Request completed", data);
    },
  });
}
