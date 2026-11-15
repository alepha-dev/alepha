import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { folios } from "../src/api/entities/folios.ts";
import {
  FolioController,
  FolioDirectoryService,
  FolioRecentlyDeleted,
  LoreRememberApi,
} from "../src/api/index.ts";

class Rows {
  folios = $repository(folios);
}

/**
 * Deleted folios (#Q3698): soft-deleted and hidden, restorable for 30 days
 * from Folio > Recently deleted, then purged for good.
 */
describe("deleted folios", () => {
  let alepha: Alepha;
  let rows: Rows;
  let owner: { id: string; roles: string[] };
  let projectId: number;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreRememberApi);
    rows = alepha.inject(Rows);
    await alepha.start();
    const user = await alepha
      .inject(UserService)
      .createUser({ username: "owner" });
    owner = { id: user.id, roles: ["user"] };
    projectId = (
      await alepha
        .inject(ProjectController)
        .createProject.fetch({ body: { title: "Deletes" } }, { user: owner })
    ).data.id;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const controller = () => alepha.inject(FolioController);

  const create = async (title: string, directoryId?: string) =>
    (
      await controller().create.fetch(
        { body: { projectId, title, content: "Body", directoryId } },
        { user: owner },
      )
    ).data;

  const deleted = async () =>
    (
      await controller().listDeletedFolios.fetch(
        { query: { projectId } },
        { user: owner },
      )
    ).data.items;

  it("hides a deleted folio from every read, and lists it as recently deleted", async ({
    expect,
  }) => {
    const folio = await create("Notes");
    await controller().delete.fetch(
      { params: { id: folio.id } },
      { user: owner },
    );

    expect(await rows.folios.findById(folio.id)).toBeUndefined();
    expect(
      await rows.folios.findMany({ where: { projectId: { eq: projectId } } }),
    ).toEqual([]);
    const listed = await deleted();
    expect(listed.map((it) => it.title)).toEqual(["Notes"]);
    expect(listed[0].deletedAt).toBeTruthy();
    // Its name is free while it is deleted.
    expect((await create("Notes")).title).toBe("Notes");
  });

  it("restores a deleted folio where it was, suffixing a title taken since", async ({
    expect,
  }) => {
    const dir = await alepha
      .inject(FolioDirectoryService)
      .create({ projectId, name: "Dir" });
    const folio = await create("Plan", dir.id);
    await controller().delete.fetch(
      { params: { id: folio.id } },
      { user: owner },
    );
    await create("Plan", dir.id);

    const restored = (
      await controller().restoreFolio.fetch(
        { params: { id: folio.id }, body: { projectId } },
        { user: owner },
      )
    ).data;
    expect(restored.directoryId).toBe(dir.id);
    expect(restored.title).not.toBe("Plan");
    expect((await rows.folios.findById(folio.id))?.id).toBe(folio.id);
    expect(await deleted()).toEqual([]);
  });

  it("deletes for good on demand, and the purge takes what is 30 days old", async ({
    expect,
  }) => {
    const gone = await create("Gone");
    const old = await create("Old");
    const recent = await create("Recent");
    for (const folio of [gone, old]) {
      await controller().delete.fetch(
        { params: { id: folio.id } },
        { user: owner },
      );
    }
    await controller().purgeFolio.fetch(
      { params: { id: gone.id }, body: { projectId } },
      { user: owner },
    );
    expect(
      await rows.folios.findById(gone.id, { force: true }),
    ).toBeUndefined();

    const dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();
    // `travel` also fires the nightly purge job: the end state is what is
    // asserted, not who purged.
    await dateTime.travel([31, "days"]);
    await controller().delete.fetch(
      { params: { id: recent.id } },
      { user: owner },
    );
    await alepha.inject(FolioRecentlyDeleted).purge();
    expect(await rows.folios.findById(old.id, { force: true })).toBeUndefined();
    expect((await deleted()).map((it) => it.title)).toEqual(["Recent"]);
  });
});
