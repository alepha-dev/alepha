import { $module, Alepha, type AppSurface, createMiddleware, z } from "alepha";
import { $secure, AlephaSecurity } from "alepha/security";
import { AlephaServerLinks, LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { $action, $middleware, ServerProvider } from "../index.ts";

/**
 * Pure controllers are created on the first request that matches one of
 * their routes (#Q3403). The list is what `alepha build` writes; here it is
 * handed over by hand, the way a spec opts into late creation.
 */
let created = 0;

class QuestApi {
  constructor() {
    created++;
  }

  list = $action({
    method: "GET",
    path: "/quests",
    schema: { response: z.object({ ok: z.boolean() }) },
    handler: () => ({ ok: true }),
  });

  secret = $action({
    method: "GET",
    path: "/quests/secret",
    use: [$secure({ roles: ["admin"] })],
    handler: () => "secret",
  });
}

const stamped: string[] = [];

class Stamp {
  stamp = $middleware({
    path: "/api",
    use: [
      createMiddleware({
        name: "$stamp",
        handler:
          ({ next }) =>
          async (...args: any[]) => {
            stamped.push("stamp");
            return next(...args);
          },
      }),
    ],
  });
}

const surface: AppSurface = {
  version: 1,
  classes: [{ key: "acme.api:QuestApi", pure: true }],
  actions: [
    {
      name: "list",
      group: "QuestApi",
      method: "GET",
      path: "/quests",
      class: "acme.api:QuestApi",
    },
    {
      name: "secret",
      group: "QuestApi",
      method: "GET",
      path: "/quests/secret",
      secured: { roles: ["admin"] },
      class: "acme.api:QuestApi",
    },
  ],
  routes: [],
  pages: [],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
};

const boot = async (opts: { list?: boolean; eager?: boolean } = {}) => {
  created = 0;
  const alepha = Alepha.create({
    env: opts.eager ? { ALEPHA_EAGER: "true" } : {},
  });
  if (opts.list !== false) {
    alepha.useSurface(opts.eager ? undefined : surface);
  }
  alepha
    .with(AlephaSecurity)
    .with(AlephaServerLinks)
    .with(Stamp)
    .with($module({ name: "acme.api", services: [QuestApi] }));
  await alepha.start();
  return { alepha, host: alepha.inject(ServerProvider).hostname };
};

describe("pure controllers created on first use", () => {
  it("creates no pure controller at boot: a cold cron never pays for one", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    expect(created).toBe(0);
    expect(alepha.isDeclared(QuestApi)).toBe(true);
    await alepha.stop();
  });

  it("creates exactly one on the first matching request, under concurrent requests", async ({
    expect,
  }) => {
    const { alepha, host } = await boot();
    const answers = await Promise.all(
      [1, 2, 3].map(() => fetch(`${host}/api/quests`)),
    );
    for (const answer of answers) {
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ ok: true });
    }
    expect(created).toBe(1);
    await alepha.stop();
  });

  it("applies global middlewares to the late route", async ({ expect }) => {
    const { alepha, host } = await boot();
    stamped.length = 0;
    await fetch(`${host}/api/quests`);
    await fetch(`${host}/api/quests`);
    expect(stamped).toEqual(["stamp", "stamp"]);
    await alepha.stop();
  });

  it("answers /api/_links from the list, secured filtering included, creating nothing", async ({
    expect,
  }) => {
    const { alepha, host } = await boot();
    const registry = (await (await fetch(`${host}/api/_links`)).json()) as {
      actions: Record<string, unknown>;
    };
    const names = Object.keys(registry.actions);
    expect(names).toContain("list");
    expect(names).not.toContain("secret");
    expect(created).toBe(0);
    await alepha.stop();
  });

  it("creates the controller a server-side call reaches", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const links = alepha.inject(LinkProvider);
    const answer = await links.client<QuestApi>().list();
    expect(answer).toEqual({ ok: true });
    expect(created).toBe(1);
    await alepha.stop();
  });

  it("creates everything at boot without a list, or with ALEPHA_EAGER=true", async ({
    expect,
  }) => {
    const plain = await boot({ list: false });
    expect(created).toBe(1);
    await plain.alepha.stop();

    const eager = await boot({ eager: true });
    expect(created).toBe(1);
    await eager.alepha.stop();
  });
});
