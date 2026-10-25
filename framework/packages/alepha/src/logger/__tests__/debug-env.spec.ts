import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import {
  AlephaLogger,
  JsonFormatterProvider,
  LogFormatterProvider,
  PrettyFormatterProvider,
} from "../index.ts";

describe("DEBUG environment variable", () => {
  /**
   * `LOG_FORMAT` and `LOG_LEVEL` are pinned, not just left unset.
   *
   * `Alepha.create()` merges `process.env` UNDERNEATH the env it is handed,
   * so every logger variable this helper does not name is inherited from
   * whoever ran the suite. CLAUDE.md tells contributors to run commands with
   * `LOG_FORMAT=pretty LOG_LEVEL=trace`, and anyone who exports that pair
   * rather than prefixing a single command turns the assertions below into a
   * reading of their shell: `LOG_FORMAT` decides the formatter outright, so
   * "keeps the production JSON format" failed with a `PrettyFormatterProvider`
   * while the DEBUG handling it covers was working perfectly.
   *
   * `LOG_LEVEL` does not change the formatter, but it does decide the
   * destination: the register block sends test-mode logs to
   * `MemoryDestinationProvider` only while no level is set, so an exported one
   * makes this file print to the console for no reason.
   */
  const formatterFor = async (env: Record<string, string | undefined>) => {
    const alepha = Alepha.create({
      env: { LOG_FORMAT: undefined, LOG_LEVEL: undefined, ...env },
    }).with(AlephaLogger);
    await alepha.start();
    const formatter = alepha.inject(LogFormatterProvider);
    await alepha.stop();
    return formatter;
  };

  it("keeps the production JSON format when DEBUG is off", async () => {
    // `"false"` and `"0"` are truthy strings; the flag has to go through
    // isEnvEnabled() like every other env switch.
    expect(
      await formatterFor({ NODE_ENV: "production", DEBUG: "false" }),
    ).toBeInstanceOf(JsonFormatterProvider);
    expect(
      await formatterFor({ NODE_ENV: "production", DEBUG: "0" }),
    ).toBeInstanceOf(JsonFormatterProvider);
  });

  it("switches to the pretty format when DEBUG is on", async () => {
    expect(
      await formatterFor({ NODE_ENV: "production", DEBUG: "1" }),
    ).toBeInstanceOf(PrettyFormatterProvider);
    expect(
      await formatterFor({ NODE_ENV: "production", DEBUG: "alepha:*" }),
    ).toBeInstanceOf(PrettyFormatterProvider);
  });

  it("lets an explicit LOG_FORMAT win over DEBUG", async () => {
    // The register block assigns the DEBUG shorthand with `??=`, so a declared
    // format is never overwritten. Without this, the pinning above could be
    // deleted and only the ambient-env failure would notice.
    expect(
      await formatterFor({
        NODE_ENV: "production",
        DEBUG: "1",
        LOG_FORMAT: "json",
      }),
    ).toBeInstanceOf(JsonFormatterProvider);
  });
});
