import { Alepha, z } from "alepha";
import { afterEach, describe, it } from "vitest";

import { $action, ServerProvider } from "../index.ts";
import { serverResponseOptions } from "../providers/ServerRouterProvider.ts";

/**
 * A JSON response's schema always shapes it (undeclared keys stripped,
 * strings trimmed) and type-checks it. Its constraint checks (here a text's
 * 255 limit) run outside production, and in production only when
 * `serverResponseOptions.checks` is `always`.
 */
class App {
  user = $action({
    method: "GET",
    path: "/user/:kind",
    schema: {
      params: z.object({ kind: z.text() }),
      response: z.object({ id: z.integer(), name: z.text() }),
    },
    handler: ({ params }): any => {
      if (params.kind === "long") {
        return { id: 1, name: "x".repeat(300) };
      }
      if (params.kind === "wrong-type") {
        return { id: "1", name: "Ada" };
      }
      return { id: 1, name: "  Ada  ", password: "secret" };
    },
  });
}

describe("JSON response checks", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const start = async (
    env: Record<string, string>,
    checks?: "always" | "development",
  ) => {
    alepha = Alepha.create({ env: { SERVER_PORT: 0, ...env } }).with(App);
    if (checks) {
      alepha.store.mut(serverResponseOptions, () => ({ checks }));
    }
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;
    return (kind: string) => fetch(`${hostname}/api/user/${kind}`);
  };

  describe("in production", () => {
    it("shapes the response: undeclared keys stripped, text trimmed", async ({
      expect,
    }) => {
      const get = await start({ NODE_ENV: "production" });

      const res = await get("ok");

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"id":1,"name":"Ada"}');
    });

    it("sends a value that fails only a constraint check", async ({
      expect,
    }) => {
      const get = await start({ NODE_ENV: "production" });

      const res = await get("long");

      expect(res.status).toBe(200);
      expect(((await res.json()) as { name: string }).name).toHaveLength(300);
    });

    it("still refuses a value of the wrong type", async ({ expect }) => {
      const get = await start({ NODE_ENV: "production" });

      const res = await get("wrong-type");

      expect(res.status).toBe(500);
    });

    it("runs the constraint checks when checks is always", async ({
      expect,
    }) => {
      const get = await start({ NODE_ENV: "production" }, "always");

      const res = await get("long");

      expect(res.status).toBe(500);
    });
  });

  describe("outside production", () => {
    it("runs the constraint checks", async ({ expect }) => {
      const get = await start({ NODE_ENV: "test" });

      const res = await get("long");

      expect(res.status).toBe(500);
    });

    it("shapes the response the same way", async ({ expect }) => {
      const get = await start({ NODE_ENV: "test" });

      const res = await get("ok");

      expect(await res.text()).toBe('{"id":1,"name":"Ada"}');
    });
  });
});
