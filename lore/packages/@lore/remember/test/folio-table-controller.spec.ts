import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  FolioController,
  FolioTableController,
  LoreRememberApi,
} from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Table folios over HTTP (#E144, #Q3512).
 */
describe("FolioTableController", () => {
  let alepha: Alepha;
  let folioController: FolioController;
  let tableController: FolioTableController;
  let projectController: ProjectController;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(LoreRememberApi);
    await alepha.start();
    folioController = alepha.inject(FolioController);
    tableController = alepha.inject(FolioTableController);
    projectController = alepha.inject(ProjectController);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const createUser = async () => {
    const fake = alepha.inject(FakeProvider).generate(userDataSchema);
    const response = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    return { id: response.data.id, roles: response.data.roles };
  };

  const createProject = async (owner: { id: string; roles: string[] }) =>
    (
      await projectController.createProject.fetch(
        { body: { title: `Tables ${crypto.randomUUID().slice(0, 8)}` } },
        { user: owner },
      )
    ).data;

  const createTable = async (
    owner: { id: string; roles: string[] },
    columns?: Array<{ name: string; type: "text" | "date" | "number" }>,
  ) => {
    const project = await createProject(owner);
    const folio = (
      await folioController.create.fetch(
        {
          body: {
            projectId: project.id,
            title: "Options",
            type: "table",
            columns,
          },
        },
        { user: owner },
      )
    ).data;
    return { project, folio };
  };

  describe("createFolio", () => {
    it("creates a table with its columns in one call", async ({ expect }) => {
      const owner = await createUser();
      const { folio } = await createTable(owner, [
        { name: "Host", type: "text" },
        { name: "Price", type: "number" },
      ]);
      expect(folio.type).toBe("table");
      expect(folio.content).toBe("");

      const table = await tableController.getFolioTable.fetch(
        { params: { id: folio.id } },
        { user: owner },
      );
      expect(table.data.columns.map((c) => c.name)).toEqual(["Host", "Price"]);
      expect(table.data.rowCount).toBe(0);
    });

    it("gives a table created without columns a Name column", async ({
      expect,
    }) => {
      const owner = await createUser();
      const { folio, project } = await createTable(owner);
      const table = await tableController.getFolioTableByShortId.fetch(
        { params: { projectId: project.id, shortId: folio.shortId } },
        { user: owner },
      );
      expect(table.data.columns.map((c) => [c.name, c.type])).toEqual([
        ["Name", "text"],
      ]);
    });

    it("refuses content on a table, at creation and on update", async ({
      expect,
    }) => {
      const owner = await createUser();
      const project = await createProject(owner);
      await expect(
        folioController.create.fetch(
          {
            body: {
              projectId: project.id,
              title: "T",
              type: "table",
              content: "# no",
            },
          },
          { user: owner },
        ),
      ).rejects.toMatchObject({ status: 400 });

      const { folio } = await createTable(owner);
      await expect(
        folioController.update.fetch(
          { params: { id: folio.id }, body: { content: "# no" } },
          { user: owner },
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("rows", () => {
    it("adds, lists with filters and paging, updates, moves and deletes", async ({
      expect,
    }) => {
      const owner = await createUser();
      const { folio } = await createTable(owner, [
        { name: "Name", type: "text" },
        { name: "Due", type: "date" },
      ]);

      const added = await tableController.addFolioRows.fetch(
        {
          params: { id: folio.id },
          body: {
            rows: [
              { cells: { Name: "a", Due: "2026-11-20" } },
              { cells: { Name: "b", Due: "2026-11-22" } },
              { cells: { Name: "c" } },
            ],
          },
        },
        { user: owner },
      );
      expect(added.data.rows.map((r) => r.number)).toEqual([1, 2, 3]);
      expect(added.data.rows[0].version).toBe(0);

      const listed = await tableController.listFolioRows.fetch(
        {
          params: { id: folio.id },
          query: {
            where: [{ column: "Due", from: "2026-11-21" }],
          },
        },
        { user: owner },
      );
      expect(listed.data.total).toBe(1);
      expect(listed.data.rows[0].number).toBe(2);

      const paged = await tableController.listFolioRows.fetch(
        {
          params: { id: folio.id },
          query: { sort: "Name", direction: "desc", limit: 1, offset: 1 },
        },
        { user: owner },
      );
      expect(paged.data.total).toBe(3);
      expect(paged.data.rows.map((r) => r.number)).toEqual([2]);

      const updated = await tableController.updateFolioRow.fetch(
        {
          params: { id: folio.id, number: 1 },
          body: { cells: { Name: "A" }, version: 0 },
        },
        { user: owner },
      );
      expect(updated.data.row.version).toBe(1);
      expect(updated.data.replaced).toEqual(["Name"]);

      await expect(
        tableController.updateFolioRow.fetch(
          {
            params: { id: folio.id, number: 1 },
            body: { cells: { Name: "stale" }, version: 0 },
          },
          { user: owner },
        ),
      ).rejects.toMatchObject({ status: 409 });

      const moved = await tableController.moveFolioRow.fetch(
        { params: { id: folio.id, number: 3 }, body: { before: 1 } },
        { user: owner },
      );
      expect(moved.data.row.number).toBe(3);

      const deleted = await tableController.deleteFolioRows.fetch(
        { params: { id: folio.id }, body: { numbers: [2, 9] } },
        { user: owner },
      );
      expect(deleted.data.deleted).toEqual([2]);

      const after = await tableController.getFolioTable.fetch(
        { params: { id: folio.id } },
        { user: owner },
      );
      expect(after.data.rows.map((r) => r.number)).toEqual([3, 1]);
    });

    it("applies column operations in order", async ({ expect }) => {
      const owner = await createUser();
      const { folio } = await createTable(owner);
      const answer = await tableController.setFolioColumns.fetch(
        {
          params: { id: folio.id },
          body: {
            operations: [
              { op: "add", name: "Due", type: "date" },
              { op: "rename", column: "Name", name: "Title" },
              { op: "move", column: "Due", position: 0 },
            ],
          },
        },
        { user: owner },
      );
      expect(answer.data.columns.map((c) => c.name)).toEqual(["Due", "Title"]);
    });
  });

  describe("gates", () => {
    it("answers 400 on a text folio", async ({ expect }) => {
      const owner = await createUser();
      const project = await createProject(owner);
      const text = (
        await folioController.create.fetch(
          { body: { projectId: project.id, title: "Notes" } },
          { user: owner },
        )
      ).data;
      expect(text.type).toBe("text");
      await expect(
        tableController.getFolioTable.fetch(
          { params: { id: text.id } },
          { user: owner },
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        tableController.addFolioRows.fetch(
          { params: { id: text.id }, body: { rows: [{ cells: {} }] } },
          { user: owner },
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("answers 403 on another project's folio and 404 on an unknown one", async ({
      expect,
    }) => {
      const owner = await createUser();
      const stranger = await createUser();
      const { folio } = await createTable(owner);
      await expect(
        tableController.getFolioTable.fetch(
          { params: { id: folio.id } },
          { user: stranger },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        tableController.addFolioRows.fetch(
          { params: { id: folio.id }, body: { rows: [{ cells: {} }] } },
          { user: stranger },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        tableController.getFolioTable.fetch(
          { params: { id: crypto.randomUUID() } },
          { user: owner },
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("the folio's version", () => {
    it("moves updatedAt on a row write, and leaves version for a concurrent title edit", async ({
      expect,
    }) => {
      const owner = await createUser();
      const { folio } = await createTable(owner);
      await alepha.inject(DateTimeProvider).travel(60_000);

      await tableController.addFolioRows.fetch(
        {
          params: { id: folio.id },
          body: { rows: [{ cells: { Name: "a" } }] },
        },
        { user: owner },
      );

      const read = (
        await folioController.get.fetch(
          { params: { id: folio.id } },
          { user: owner },
        )
      ).data;
      expect(read.version).toBe(folio.version);
      expect(read.updatedAt > folio.updatedAt).toBe(true);

      // A title edit against the version read BEFORE the row write lands.
      const renamed = await folioController.update.fetch(
        {
          params: { id: folio.id },
          body: { title: "Renamed", expectedVersion: folio.version },
        },
        { user: owner },
      );
      expect(renamed.data.title).toBe("Renamed");
    });
  });
});
