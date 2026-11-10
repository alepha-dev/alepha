import { Alepha, z } from "alepha";
import { AlephaServerLinks } from "alepha/server/links";
import { describe, expect, it } from "vitest";

import { $action, $route, ServerProvider } from "../index.ts";

/**
 * Whether a `$route` under the action prefix (`/api`) answers.
 *
 * The AGENTS.md files used to say the action dispatcher shadows `/api/*` and
 * a route there answers 404. This spec is what that sentence is checked
 * against, with actions and the links module mounted, as in an app.
 */
describe("a $route under /api", () => {
  const boot = async () => {
    class App {
      hello = $action({
        method: "GET",
        path: "/hello",
        schema: { response: z.object({ ok: z.boolean() }) },
        handler: () => ({ ok: true }),
      });

      exact = $route({ path: "/api", handler: () => "root" });

      plain = $route({ path: "/api/x", handler: () => "x" });

      param = $route({
        path: "/api/things/:id",
        schema: { params: z.object({ id: z.text() }) },
        handler: ({ params }) => `thing ${params.id}`,
      });
    }

    const alepha = Alepha.create().with(AlephaServerLinks).with(App);
    await alepha.start();
    return alepha.inject(ServerProvider).hostname;
  };

  it("answers, beside the actions it shares the prefix with", async () => {
    const host = await boot();

    const action = await fetch(`${host}/api/hello`);
    expect(action.status).toBe(200);
    expect(await action.json()).toEqual({ ok: true });

    const plain = await fetch(`${host}/api/x`);
    expect(plain.status).toBe(200);
    expect(await plain.text()).toBe("x");

    const param = await fetch(`${host}/api/things/42`);
    expect(param.status).toBe(200);
    expect(await param.text()).toBe("thing 42");

    const exact = await fetch(`${host}/api`);
    expect(exact.status).toBe(200);
    expect(await exact.text()).toBe("root");
  });
});
