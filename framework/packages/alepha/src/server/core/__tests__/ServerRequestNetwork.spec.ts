import { Alepha } from "alepha";
import { $route, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

class App {
  public readonly probe = $route({
    path: "/probe",
    handler: (request) =>
      JSON.stringify({ network: request.geo.network ?? null }),
  });
}

describe("request.geo.network (Node)", () => {
  it("is absent on Node, whatever headers the client sends", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } }).with(App);
    const server = alepha.inject(ServerProvider);
    await alepha.start();
    try {
      const hostname = server.hostname;
      const response = await fetch(`${hostname}/probe`, {
        headers: { "cf-asn": "13335", "x-asn": "13335" },
      });
      expect(await response.json()).toEqual({ network: null });
    } finally {
      await alepha.stop();
    }
  });
});
