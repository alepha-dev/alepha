import { Alepha } from "@alepha/core";
import { ServerProvider } from "@alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaServerHealth } from "../src";

const alepha = Alepha.create().with(AlephaServerHealth);

describe("ServerHealthProvider", () => {
  it("should expose health endpoint with server status", async () => {
    const srv = alepha.inject(ServerProvider);
    const hostname = srv.hostname;

    const ping = await fetch(`${hostname}/health`);

    expect(await ping.json()).toEqual({
      message: "OK",
      uptime: expect.any(Number),
      date: expect.any(String),
      ready: true,
    });
  });
});
