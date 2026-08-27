import { Alepha, z } from "alepha";
import {
  $logger,
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { beforeEach, describe, it } from "vitest";

import {
  $action,
  AlephaServer,
  HttpError,
  ServerLoggerProvider,
} from "../index.ts";

class App {
  log = $logger();
  ping = $action({
    handler: () => {
      this.log.info("!!");
      return "pong";
    },
  });
  silent = $action({
    silent: true,
    handler: () => {
      this.log.info("this message should be logged");
      return "silent";
    },
  });
  error = $action({
    handler: () => {
      throw new HttpError({
        message: "Sorry",
        status: 400,
      });
    },
  });
  boom = $action({
    handler: () => {
      throw new Error("kaboom");
    },
  });
  callback = $action({
    schema: {
      query: z.object({
        code: z.text().optional(),
        state: z.text().optional(),
        redirect: z.text().optional(),
      }),
    },
    handler: () => "ok",
  });
}

const alepha = Alepha.create({
  env: {
    LOG_LEVEL: "info",
  },
})
  .with({
    provide: LogDestinationProvider,
    use: MemoryDestinationProvider,
  })
  .with(AlephaServer)
  .with(ServerLoggerProvider);

const app = alepha.inject(App);
const log = alepha.inject(MemoryDestinationProvider);

describe("ServerLoggerProvider", () => {
  beforeEach(() => {
    log.clear();
  });

  it("should log incoming request, custom logs, and request completed for ok response", async ({
    expect,
  }) => {
    expect(log.logs.length).toBe(0);
    const response = await app.ping.fetch();
    expect(response.data).toBe("pong");
    expect(log.logs[0].message).toBe("Incoming request");
    expect(log.logs[1].message).toBe("!!");
    expect(log.logs[2].message).toBe("Request completed");
  });

  // An expected 4xx is the server working correctly — a missing session,
  // a role the caller lacks, a malformed body. Logging those at `error`
  // with a stack buries genuine faults: on a public app the error channel
  // fills with ordinary unauthenticated traffic and alerting on it is
  // worthless. They drop to `debug`, below this app's `info` level.
  it("does not log an expected 4xx at error level", async ({ expect }) => {
    expect(log.logs.length).toBe(0);
    const response = await app.error
      .fetch()
      .then((it) => it.data)
      .catch((e) => HttpError.toJSON(e));

    expect(response).toEqual({
      message: "Sorry",
      status: 400,
      error: "BadRequestError",
      requestId: expect.any(String),
    });
    expect(log.logs[0].message).toBe("Incoming request");
    expect(log.logs[1].message).toBe("Request completed");
    expect(log.logs.some((l) => l.level === "ERROR")).toBe(false);
  });

  it("still logs a 5xx at error level", async ({ expect }) => {
    expect(log.logs.length).toBe(0);
    await app.boom.fetch().catch(() => undefined);

    expect(log.logs[0].message).toBe("Incoming request");
    expect(log.logs[1].message).toBe("Request has failed");
    expect(log.logs[1].level).toBe("ERROR");
  });

  /**
   * The path is logged at info level, so an OAuth callback wrote a live
   * authorization code straight into production logs. The key stays - knowing
   * which parameters a request carried is most of what the line is for - and
   * only the value goes.
   */
  it("redacts credential-bearing query values from both log lines", async ({
    expect,
  }) => {
    await app.callback.fetch({
      query: { code: "live-authorization-code", state: "csrf-state" },
    });

    const paths = log.logs
      .filter(
        (l) =>
          l.message.startsWith("Incoming request") ||
          l.message.startsWith("Request completed"),
      )
      .map((l) => (l.data as { path: string }).path);

    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path).toContain("code=[redacted]");
      expect(path).toContain("state=[redacted]");
      expect(path).not.toContain("live-authorization-code");
      expect(path).not.toContain("csrf-state");
    }
  });

  it("leaves an ordinary query untouched", async ({ expect }) => {
    await app.callback.fetch({ query: { redirect: "/home" } });

    const path = (log.logs[0].data as { path: string }).path;
    expect(path).toContain("redirect=%2Fhome");
    expect(path).not.toContain("redacted");
  });

  it("should not log request lifecycle for silent actions but still log custom messages", async ({
    expect,
  }) => {
    expect(log.logs.length).toBe(0);
    const response = await app.silent.fetch();
    expect(response.data).toBe("silent");
    expect(log.logs[0].message).toBe("this message should be logged");
    expect(log.logs.length).toBe(1);
  });
});
