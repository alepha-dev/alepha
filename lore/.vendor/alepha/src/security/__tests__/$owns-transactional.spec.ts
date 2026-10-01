import { Alepha, z } from "alepha";
import { $entity, $repository, $transactional, db } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $action, AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaSecurity } from "../index.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { $owns } from "../primitives/$owns.ts";

/**
 * #Q2538. `$transactional()` runs the rest of the chain in a nested context
 * layer. A guard declared after it used to read the action's request from
 * the CURRENT layer only, so called in-process (`action.run()`, and every MCP
 * tool) it saw no body at all and `$owns` refused with "'projectId' is not
 * present in the body". Over HTTP it passed, only because the fallback found
 * the HTTP request. The guard now reads through nested layers to the
 * action's own fork, and never past it into an enclosing action's.
 */
const projects = $entity({
  name: "owns_tx_projects",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const owner: UserAccountToken = { id: "u1", realm: "default", roles: [] };

class App {
  projects = $repository(projects);

  rename = $action({
    use: [
      $transactional(),
      $owns({
        repository: () => this.projects,
        param: "projectId",
        from: "body",
        owner: "createdBy",
      }),
    ],
    schema: {
      body: z.object({ projectId: z.integer(), title: z.text() }),
      response: z.text(),
    },
    handler: async ({ body }) => {
      await this.projects.updateById(body.projectId, { title: body.title });
      return body.title;
    },
  });

  // An action with no body of its own, called from inside one that has one.
  // Its guard must not borrow the enclosing action's body.
  bodiless = $action({
    use: [
      $transactional(),
      $owns({
        repository: () => this.projects,
        param: "projectId",
        from: "body",
        owner: "createdBy",
      }),
    ],
    schema: { response: z.text() },
    handler: async () => "reached",
  });

  outer = $action({
    schema: {
      body: z.object({ projectId: z.integer() }),
      response: z.text(),
    },
    handler: async () => this.bodiless.run({}, { user: owner }),
  });
}

const boot = async (alepha: Alepha) => {
  alepha.with(AlephaServer).with(AlephaSecurity).with(App);
  await alepha.start();
  const app = alepha.inject(App);
  await app.projects.create({ id: 1, createdBy: "u1", title: "Alpha" });
  return app;
};

const cases = [
  [
    "sqlite",
    () => Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
  ],
  ["postgres", () => Alepha.create().with(AlephaOrmPostgres)],
] as const;

describe("$owns after $transactional(), called in-process", () => {
  for (const [driver, create] of cases) {
    it(`reads the body through the transaction's layer (${driver})`, async ({
      expect,
    }) => {
      const alepha = create();
      const app = await boot(alepha);

      const renamed = await app.rename.run(
        { body: { projectId: 1, title: "Beta" } },
        { user: owner },
      );

      expect(renamed).toBe("Beta");
      expect((await app.projects.findById(1))?.title).toBe("Beta");
      await alepha.stop();
    });

    it(`never reads an enclosing action's body (${driver})`, async ({
      expect,
    }) => {
      const alepha = create();
      const app = await boot(alepha);

      await expect(
        app.outer.run({ body: { projectId: 1 } }, { user: owner }),
      ).rejects.toThrow(/not present in the body/);
      await alepha.stop();
    });
  }
});
