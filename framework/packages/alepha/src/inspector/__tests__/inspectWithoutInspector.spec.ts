import { Alepha } from "alepha";
import { MemoryDestinationProvider } from "alepha/logger";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaInspector } from "../index.ts";

const MESSAGE = /ALEPHA_INSPECT is set, but this build carries no inspector/;

/**
 * `ALEPHA_INSPECT=1` given to a build made without `alepha build --inspect`:
 * nothing listens, and silence would read as "on".
 */
describe("ALEPHA_INSPECT on a server without the inspector", () => {
  const boot = async (env: Record<string, string>, inspector: boolean) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0, ...env } }).with(
      AlephaServer,
    );
    if (inspector) alepha.with(AlephaInspector);
    await alepha.start();
    const logs = alepha.inject(MemoryDestinationProvider);
    await alepha.stop();
    return logs;
  };

  it("logs one line saying so", async ({ expect }) => {
    const logs = await boot({ ALEPHA_INSPECT: "1" }, false);

    expect(logs.wasLogged(MESSAGE, "WARN")).toBe(true);
    expect(logs.logs.filter((l) => MESSAGE.test(l.message))).toHaveLength(1);
  });

  it("says nothing when the inspector is there, or was not asked for", async ({
    expect,
  }) => {
    expect((await boot({ ALEPHA_INSPECT: "1" }, true)).wasLogged(MESSAGE)).toBe(
      false,
    );
    expect((await boot({}, false)).wasLogged(MESSAGE)).toBe(false);
  });
});
