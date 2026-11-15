import { ProjectController, ResourceLinkService } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm, DatabaseProvider, sql } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  DirectoryController,
  FolioController,
  FolioTableController,
  LoreRememberApi,
} from "../src/api/index.ts";
import { FolioTools, LoreRememberMcp } from "../src/mcp/index.ts";

const onPostgres = process.env.DATABASE_TEST_DIALECT === "postgres";
/**
 * The rest of Lore meets a table folio (#E144, #Q3514): search, links, pin,
 * encrypt, export, the index.
 */
describe("table folios and the readers of a folio", () => {
  let alepha: Alepha;
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
    alepha.with(AlephaFake);
    alepha.with(AlephaMcp);
    alepha.with(LoreRememberApi);
    alepha.with(LoreRememberMcp);
    await alepha.start();
    const user = await alepha.inject(UserService).createUser({
      username: "owner",
    });
    owner = { id: user.id, roles: ["user"] };
    projectId = (
      await alepha
        .inject(ProjectController)
        .createProject.fetch({ body: { title: "Readers" } }, { user: owner })
    ).data.id;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const folios = () => alepha.inject(FolioController);
  const tables = () => alepha.inject(FolioTableController);

  const createFolio = async (body: Record<string, unknown>) =>
    (
      await folios().create.fetch(
        { body: { projectId, ...body } as never },
        { user: owner },
      )
    ).data;

  const createTable = async (title: string) =>
    createFolio({
      title,
      type: "table",
      columns: [
        { name: "Host", type: "text" },
        { name: "See", type: "reference" },
      ],
    });

  const addRows = async (id: string, rows: Array<Record<string, unknown>>) =>
    tables().addFolioRows.fetch(
      { params: { id }, body: { rows: rows.map((cells) => ({ cells })) } },
      { user: owner },
    );

  describe("search", () => {
    it("finds a table by a row, once, with the row as its match", async ({
      expect,
    }) => {
      const table = await createTable("Hosting");
      await addRows(table.id, [
        { Host: "Fly regional" },
        { Host: "Fly global" },
        { Host: "Render" },
      ]);
      await createFolio({ title: "Notes", content: "fly me to the moon" });

      const found = (
        await folios().list.fetch(
          { query: { projectId, q: "fly" } },
          { user: owner },
        )
      ).data;
      expect(found.map((f) => f.title).sort()).toEqual(["Hosting", "Notes"]);
      const hit = found.find((f) => f.title === "Hosting")!;
      expect(hit.rowMatch).toEqual({ number: 1, text: "Host: Fly regional" });
    });

    it("answers a row snippet from folio_search, and finds it in the directory search", async ({
      expect,
    }) => {
      const table = await createTable("Hosting");
      await addRows(table.id, [{ Host: "Hetzner" }]);
      const snippet = await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, owner);
        return (alepha.inject(FolioTools).folio_search as any).execute({
          project: projectId,
          query: "hetzner",
        });
      });
      expect(snippet.results).toEqual([
        expect.objectContaining({
          shortId: table.shortId,
          snippet: "Row 1: Host: Hetzner",
        }),
      ]);

      const entries = (
        await alepha
          .inject(DirectoryController)
          .searchFolio.fetch(
            { params: { projectId }, query: { q: "hetzner" } },
            { user: owner },
          )
      ).data.entries;
      expect(entries.map((e) => e.name)).toEqual(["Hosting"]);
    });

    // SQLite only on purpose: it reads SQLite's EXPLAIN QUERY PLAN.
    it.skipIf(onPostgres)(
      "scopes the row query to the project's tables by index",
      async ({ expect }) => {
        const database = alepha.inject(DatabaseProvider);
        const plan = (await database.execute(
          sql`EXPLAIN QUERY PLAN SELECT * FROM folio_rows WHERE folio_id IN (${"a"}, ${"b"}) AND search_text LIKE ${"%x%"} ORDER BY position`,
        )) as Array<{ detail: string }>;
        const detail = plan.map((row) => row.detail).join(" | ");
        expect(detail).toMatch(/USING INDEX folio_rows_folio_id/);
        expect(detail).not.toMatch(/SCAN folio_rows(?! USING)/);
      },
    );
  });

  describe("links", () => {
    it("syncs reference cells into the link graph, and a removed reference drops", async ({
      expect,
    }) => {
      const target = await createFolio({ title: "Decision", content: "x" });
      const table = await createTable("Options");
      await addRows(table.id, [{ Host: "a", See: `#F${target.shortId}` }]);

      const links = alepha.inject(ResourceLinkService);
      expect(
        (await links.findOutbound({ kind: "folio", id: table.id })).map(
          (l) => l.toId,
        ),
      ).toEqual([target.id]);

      const backlinks = (
        await folios().getLinks.fetch(
          { params: { id: target.id } },
          { user: owner },
        )
      ).data.inbound;
      expect(backlinks.map((l) => l.title)).toEqual(["Options"]);

      await tables().setFolioColumns.fetch(
        {
          params: { id: table.id },
          body: { operations: [{ op: "remove", column: "See" }] },
        },
        { user: owner },
      );
      expect(await links.findOutbound({ kind: "folio", id: table.id })).toEqual(
        [],
      );
    });
  });

  describe("pin and encrypt", () => {
    it("refuses both on a table, saying why", async ({ expect }) => {
      const table = await createTable("Options");
      await expect(
        folios().update.fetch(
          { params: { id: table.id }, body: { pinned: true } },
          { user: owner },
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/cannot be pinned/),
      });
      await expect(
        folios().update.fetch(
          { params: { id: table.id }, body: { protected: true, content: "" } },
          { user: owner },
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/cannot be encrypted/),
      });
    });
  });

  describe("export", () => {
    it("exports a table as CSV in stored order, with a BOM", async ({
      expect,
    }) => {
      const table = await createTable("Options");
      await addRows(table.id, [{ Host: "b" }, { Host: "a, quoted" }]);
      const answer = (
        await tables().exportFolioTable.fetch(
          { params: { id: table.id } },
          { user: owner },
        )
      ).data;
      expect(answer.rowCount).toBe(2);
      expect(answer.csv).toBe('﻿Host,See\r\nb,\r\n"a, quoted",\r\n');
    });
  });

  describe("the index", () => {
    it("carries type in folio_list", async ({ expect }) => {
      await createTable("Options");
      await createFolio({ title: "Notes" });
      const list = await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, owner);
        return (alepha.inject(FolioTools).folio_list as any).execute({
          project: projectId,
        });
      });
      expect(
        list.folios.map((f: { title: string; type: string }) => [
          f.title,
          f.type,
        ]),
      ).toEqual(
        expect.arrayContaining([
          ["Options", "table"],
          ["Notes", "text"],
        ]),
      );
    });
  });

  describe("activity", () => {
    it("shows one event for a session of row writes", async ({ expect }) => {
      const table = await createTable("Options");
      await addRows(table.id, [{ Host: "a" }]);
      await addRows(table.id, [{ Host: "b" }]);
      await tables().updateFolioRow.fetch(
        { params: { id: table.id, number: 1 }, body: { cells: { Host: "c" } } },
        { user: owner },
      );
      const feed = (
        await folios().listProjectActivity.fetch(
          { query: { projectId } },
          { user: owner },
        )
      ).data.items.filter((item) => item.folioId === table.id);
      expect(feed).toHaveLength(1);
    });
  });
});
