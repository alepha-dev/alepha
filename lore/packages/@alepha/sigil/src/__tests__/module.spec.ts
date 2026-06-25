import { Alepha } from "alepha";
import { RootComponentsProvider } from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { AlephaSigil } from "../index.ts";

describe("AlephaSigil module", () => {
  it("mounts SigilRoot via rootComponents in production", async () => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", SERVER_PORT: 0, SIGIL_ID: "x" },
    }).with(AlephaSigil);
    await alepha.start();
    expect(alepha.inject(RootComponentsProvider).rootComponents.length).toBe(1);
  });

  it("mounts nothing in dev", async () => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "development", SERVER_PORT: 0 },
    }).with(AlephaSigil);
    await alepha.start();
    expect(alepha.inject(RootComponentsProvider).rootComponents.length).toBe(0);
  });
});
