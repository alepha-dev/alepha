import { $hook, $inject, Alepha } from "alepha";
import { $logger, LogBufferProvider, type LogEntry } from "alepha/logger";
import { beforeEach, describe, it } from "vitest";

import { $action, ServerProvider } from "../index.ts";

class TestApp {
  protected readonly log = $logger();

  boom = $action({
    handler: () => {
      this.log.debug("step one");
      this.log.info("step two");
      throw new Error("boom");
    },
  });
}

/**
 * Stand-in for an external error reporter: grabs whatever the framework can
 * hand it at the moment a request fails.
 */
class Reporter {
  protected readonly logBuffer = $inject(LogBufferProvider);

  public breadcrumbs?: LogEntry[];

  public readonly onError = $hook({
    on: "server:onError",
    handler: () => {
      this.breadcrumbs = this.logBuffer.snapshot();
    },
  });
}

describe("ServerRouterProvider - log buffer", () => {
  let alepha: Alepha;
  let reporter: Reporter;
  let hostname: string;

  beforeEach(async () => {
    alepha = Alepha.create().with(TestApp).with(Reporter);
    reporter = alepha.inject(Reporter);
    await alepha.start();
    hostname = alepha.inject(ServerProvider).hostname;
  });

  it("should expose the request's log entries to the error hook", async ({
    expect,
  }) => {
    await fetch(`${hostname}/api/boom`);

    expect(reporter.breadcrumbs?.map((entry) => entry.message)).toContain(
      "step one",
    );
    expect(reporter.breadcrumbs?.map((entry) => entry.message)).toContain(
      "step two",
    );
  });

  it("should return a requestId that matches the context tagging the logs", async ({
    expect,
  }) => {
    const response = await fetch(`${hostname}/api/boom`);
    const body = await response.json();

    const contexts = new Set(
      reporter.breadcrumbs?.map((entry) => entry.context),
    );

    expect(contexts).toEqual(new Set([body.requestId]));
  });
});
