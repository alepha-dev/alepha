import { $inject, Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $action, ServerProvider, ServerRouterProvider } from "../index.ts";

class TestApp {
  protected readonly alepha = $inject(Alepha);

  public seen: unknown;

  user = $action({
    path: "/users/:id",
    method: "GET",
    schema: { params: z.object({ id: z.text() }) },
    handler: () => {
      this.seen = this.alepha.context.get(ServerRouterProvider.ROUTE_KEY);
      return "ok";
    },
  });
}

/**
 * The request context names the route pattern being served (#Q3760), so a
 * failure reported from deep inside a handler (an error-level log line) can
 * say which route it was on, never the concrete URL, which holds ids.
 */
describe("ServerRouterProvider - route key", () => {
  it("holds the route pattern, not the concrete URL, while a request runs", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(TestApp);
    await alepha.start();
    try {
      const hostname = alepha.inject(ServerProvider).hostname;
      const response = await fetch(`${hostname}/api/users/42`);
      expect(response.status).toBe(200);

      const seen = alepha.inject(TestApp).seen;
      expect(seen).toBe("/api/users/:id");
      expect(alepha.context.get(ServerRouterProvider.ROUTE_KEY)).toBe(
        undefined,
      );
    } finally {
      await alepha.stop();
    }
  });
});
