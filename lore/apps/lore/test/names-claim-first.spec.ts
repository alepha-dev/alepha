import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { areas } from "../src/api/entities/areas.ts";
import { folioNames } from "../src/api/entities/folioNames.ts";
import { LoreApi } from "../src/api/index.ts";
import { AreaService } from "../src/api/services/AreaService.ts";

class Rows {
  names = $repository(folioNames);
  areas = $repository(areas);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Names are claimed before their row is written (#Q2548), with transactions
 * off as on D1: two concurrent creates of one title both see it free, and
 * the UNIQUE index on `folio_names` is all that separates them.
 */
describe("names are claimed before the row", () => {
  let alepha: Alepha;
  let rows: Rows;
  let user: { id: string; roles: string[] };
  let projectId: number;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
        DATABASE_URL: ":memory:",
        DATABASE_TRANSACTIONS: false,
      },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(LoreApi);
    rows = alepha.inject(Rows);
    await alepha.start();

    const fake = alepha.inject(FakeProvider).generate(userDataSchema);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    user = { id: created.data.id, roles: created.data.roles };
    const project = await alepha
      .inject(ProjectController)
      .createProject.fetch({ body: { title: "Claims" } }, { user });
    projectId = project.data.id;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("two concurrent folio creates of one title give X and X (1), each reserved", async ({
    expect,
  }) => {
    const folios = alepha.inject(FolioController);
    const create = () =>
      folios.create.fetch(
        { body: { projectId, title: "Runbook", content: "" } },
        { user },
      );

    const [a, b] = await Promise.all([create(), create()]);

    expect([a.data.title, b.data.title].sort()).toEqual([
      "Runbook",
      "Runbook (1)",
    ]);
    for (const folio of [a.data, b.data]) {
      const reserved = await rows.names.findMany({
        where: { entityId: { eq: folio.id } },
      });
      expect(reserved.map((it) => it.lowerName)).toEqual([
        folio.title.toLowerCase(),
      ]);
    }
  });

  it("two concurrent directory creates of one name give X and X (1)", async ({
    expect,
  }) => {
    const directories = alepha.inject(DirectoryController);
    const create = () =>
      directories.createDirectory.fetch(
        { params: { projectId }, body: { name: "Specs" } },
        { user },
      );

    const [a, b] = await Promise.all([create(), create()]);

    expect([a.data.name, b.data.name].sort()).toEqual(["Specs", "Specs (1)"]);
    expect(
      await rows.names.count({ entityId: { inArray: [a.data.id, b.data.id] } }),
    ).toBe(2);
  });

  it("two concurrent first uses of an area give one area", async ({
    expect,
  }) => {
    const service = alepha.inject(AreaService);

    const [a, b] = await Promise.all([
      service.ensureArea(projectId, "Payments"),
      service.ensureArea(projectId, "Payments"),
    ]);

    expect(a?.id).toBe(b?.id);
    expect(
      await rows.areas.count({
        projectId: { eq: projectId },
        name: { eq: "Payments" },
      }),
    ).toBe(1);
  });
});
