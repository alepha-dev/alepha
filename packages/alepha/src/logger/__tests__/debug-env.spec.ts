import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import {
  AlephaLogger,
  JsonFormatterProvider,
  LogFormatterProvider,
  PrettyFormatterProvider,
} from "../index.ts";

describe("DEBUG environment variable", () => {
  const formatterFor = async (env: Record<string, string>) => {
    const alepha = Alepha.create({ env }).with(AlephaLogger);
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
});
