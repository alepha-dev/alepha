import { Alepha } from "alepha";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

const alepha = Alepha.create().with(AlephaServer);

describe("ServerHealthProvider", () => {
  /**
   * `AlephaServer` alone, with nothing added. That is the point of the test:
   * a supervisor starting an app cannot ask it to opt into being checkable, so
   * `/health` has to be there for an app whose author never thought about it.
   */
  it("should expose /health on a plain server, with no module opted in", async () => {
    const srv = alepha.inject(ServerProvider);

    const ping = await fetch(`${srv.hostname}/health`);

    expect(await ping.json()).toEqual({
      message: "OK",
      uptime: expect.any(Number),
      date: expect.any(String),
      ready: true,
    });
  });

  it("should expose /healthz too, for probes that expect that spelling", async () => {
    const srv = alepha.inject(ServerProvider);

    const ping = await fetch(`${srv.hostname}/healthz`);

    expect(ping.status).toBe(200);
    expect((await ping.json()).ready).toBe(true);
  });
});
