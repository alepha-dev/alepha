import { Alepha } from "alepha";
import {
  $logger,
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { beforeEach, describe, it } from "vitest";

import { $action, AlephaServer, BadRequestError } from "../index.ts";

/**
 * A handler that throws a bare `Error` for a business rule looks correct
 * in development — the message is passed straight through — and then
 * silently degrades to a generic "Internal Server Error" in production,
 * because 5xx messages are sanitised. The author never sees the
 * difference locally, so the mistake ships.
 *
 * Development now warns, naming the fix.
 */
class App {
  log = $logger();

  bare = $action({
    handler: () => {
      throw new Error("Current password is incorrect");
    },
  });

  typed = $action({
    handler: () => {
      throw new BadRequestError("Current password is incorrect");
    },
  });
}

const alepha = Alepha.create({ env: { LOG_LEVEL: "warn" } })
  .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
  .with(AlephaServer);

const app = alepha.inject(App);
const log = alepha.inject(MemoryDestinationProvider);

describe("bare Error warning", () => {
  beforeEach(() => log.clear());

  it("warns when a handler throws a non-HttpError", async ({ expect }) => {
    await app.bare.fetch().catch(() => undefined);

    const warning = log.logs.find(
      (l) => l.level === "WARN" && l.message.includes("non-HttpError"),
    );
    expect(warning).toBeDefined();
    // The warning has to name the remedy, otherwise it is just noise.
    expect(warning?.message).toContain("BadRequestError");
  });

  it("stays quiet when the handler throws a typed HttpError", async ({
    expect,
  }) => {
    await app.typed.fetch().catch(() => undefined);

    expect(log.logs.some((l) => l.message.includes("non-HttpError"))).toBe(
      false,
    );
  });
});
