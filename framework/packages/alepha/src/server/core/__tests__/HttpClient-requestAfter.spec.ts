import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { $action, AlephaServer, NotFoundError } from "../index.ts";

/**
 * `client:request:after` closes every `client:request:before` (#Q4113): a
 * debugging trail sees each named call end, answered or refused.
 */
describe("client:request:after", () => {
  class Api {
    ping = $action({
      method: "GET",
      path: "/ping",
      handler: async () => "pong",
    });

    missing = $action({
      method: "GET",
      path: "/missing",
      handler: async () => {
        throw new NotFoundError("nothing here");
      },
    });
  }

  it("fires with the action, its status and its duration, on success and on failure", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer).with(Api);
    await alepha.start();
    const seen: Array<{ path: string; status?: number; ok: boolean }> = [];
    alepha.events.on("client:request:after", (ev) => {
      expect(ev.durationMs).toBeGreaterThanOrEqual(0);
      seen.push({ path: ev.route.path, status: ev.status, ok: ev.ok });
    });
    const api = alepha.inject(Api);

    await api.ping.fetch();
    await expect(api.missing.fetch()).rejects.toThrow();

    expect(seen).toEqual([
      { path: "/ping", status: 200, ok: true },
      { path: "/missing", status: 404, ok: false },
    ]);
    await alepha.stop();
  });
});
