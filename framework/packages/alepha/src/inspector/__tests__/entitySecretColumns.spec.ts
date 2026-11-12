import { Alepha, z } from "alepha";
import { $entity, $repository, db, AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { AlephaInspector } from "../index.ts";
import { InspectorDispatcher } from "../services/InspectorDispatcher.ts";

const members = $entity({
  name: "inspector_secret_members",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    email: z.text(),
    password: z.text().meta({ secret: true }).optional(),
    pin: z.text({ secret: true }).default("0000"),
  }),
});

class Db {
  members = $repository(members);
}

describe("GET /metadata - secret columns", () => {
  it("reports secret: true on marked columns only, and /db rows keep their values", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { ALEPHA_INSPECT: "1", LOG_LEVEL: "error" },
    })
      .with(AlephaOrmTestPostgres)
      .with(AlephaInspector);
    const repo = alepha.inject(Db).members;
    await alepha.start();
    await repo.create({
      email: "a@example.app",
      password: "hash",
      pin: "1234",
    });

    const dispatcher = alepha.inject(InspectorDispatcher);
    const meta = await dispatcher.dispatch({
      method: "GET",
      path: "/metadata",
    });
    const body = JSON.parse(JSON.stringify(meta.body));
    const entity = body.entities.find(
      (e: { name: string }) => e.name === members.name,
    );
    const flags = Object.fromEntries(
      entity.columns.map((c: { name: string; secret?: boolean }) => [
        c.name,
        c.secret,
      ]),
    );
    expect(flags).toEqual({
      id: undefined,
      email: undefined,
      password: true,
      pin: true,
    });

    const rows = await dispatcher.dispatch({
      method: "GET",
      path: `/db/${members.name}/records`,
    });
    expect((rows.body as any).content[0].password).toBe("hash");

    await alepha.stop();
  });
});
