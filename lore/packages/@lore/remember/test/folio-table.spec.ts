import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { folioColumns } from "../src/api/entities/folioColumns.ts";
import { folioRows } from "../src/api/entities/folioRows.ts";
import {
  FolioTableService,
  type FolioTableTarget,
  LoreRememberApi,
} from "../src/api/index.ts";
import { folioTreeEntrySchema } from "../src/api/schemas/folioTreeEntrySchema.ts";
import {
  createTestFolio,
  createTestProject,
  KnowledgeTestEntities,
} from "../src/testing/index.ts";

class TableRepos {
  columns = $repository(folioColumns);
  rows = $repository(folioRows);
}

/**
 * Table folios' storage and service (#E144, #Q3511).
 */
describe("FolioTableService", () => {
  let alepha: Alepha;
  let repos: KnowledgeTestEntities;
  let tables: TableRepos;

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
    repos = alepha.inject(KnowledgeTestEntities);
    tables = alepha.inject(TableRepos);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const service = () => alepha.inject(FolioTableService);

  const createTable = async (
    columns: Parameters<FolioTableService["seedColumns"]>[1] = [],
  ): Promise<FolioTableTarget & { shortId: number }> => {
    const project = await createTestProject(alepha);
    const folio = await createTestFolio(alepha, project, { type: "table" });
    await service().seedColumns(folio, columns);
    return folio;
  };

  describe("the folio", () => {
    it("reads text by default, and a tree entry carries its type", async ({
      expect,
    }) => {
      const project = await createTestProject(alepha);
      const folio = await createTestFolio(alepha, project);
      expect(folio.type).toBe("text");
      expect(folioTreeEntrySchema.shape.type).toBeDefined();
    });

    it("refuses table operations on a text folio", async ({ expect }) => {
      const project = await createTestProject(alepha);
      const folio = await createTestFolio(alepha, project);
      await expect(service().listRows(folio)).rejects.toThrow(/not a table/);
    });

    it("cascades its columns and rows when it is deleted", async ({
      expect,
    }) => {
      const folio = await createTable();
      await service().addRows(folio, [{ cells: { Name: "a" } }]);
      await repos.folios.deleteById(folio.id);
      expect(await tables.columns.count({ folioId: { eq: folio.id } })).toBe(0);
      expect(await tables.rows.count({ folioId: { eq: folio.id } })).toBe(0);
    });

    it("copies columns and rows with fresh ids and the same numbers", async ({
      expect,
    }) => {
      const source = await createTable([
        { name: "Name", type: "text" },
        { name: "Done", type: "checkbox" },
      ]);
      await service().addRows(source, [
        { cells: { Name: "a", Done: true } },
        { cells: { Name: "b" } },
      ]);
      await service().deleteRows(source, [1]);
      const project = await repos.projects.findById(source.projectId);
      const target = await createTestFolio(alepha, project!, {
        type: "table",
      });

      await service().copyTable(source.id, target.id);

      const copied = await service().listRows(target);
      expect(copied.columns.map((c) => c.name)).toEqual(["Name", "Done"]);
      expect(copied.columns[0].id).not.toBe(
        (await service().columnsOf(source.id))[0].id,
      );
      expect(copied.rows.map((r) => r.number)).toEqual([2]);
      expect(copied.rows[0].cells[copied.columns[0].id]).toBe("b");
      const [added] = await service().addRows(target, [{ cells: {} }]);
      expect(added.number).toBe(3);
    });
  });

  describe("columns", () => {
    it("gives a table created without columns a Name column", async ({
      expect,
    }) => {
      const folio = await createTable();
      const columns = await service().columnsOf(folio.id);
      expect(columns.map((c) => [c.name, c.type])).toEqual([["Name", "text"]]);
    });

    it("applies operations in order: add, rename, move, options, remove", async ({
      expect,
    }) => {
      const folio = await createTable();
      const columns = await service().applyColumnOperations(folio, [
        {
          op: "add",
          name: "Status",
          type: "select",
          options: { choices: ["Todo", "Done"] },
        },
        { op: "add", name: "Due", type: "date", options: { withTime: true } },
        { op: "rename", column: "status", name: "State" },
        { op: "move", column: "Due", position: 0 },
        {
          op: "setOptions",
          column: "State",
          options: { choices: ["Todo", "Doing", "Done"] },
        },
      ]);
      expect(columns.map((c) => c.name)).toEqual(["Due", "Name", "State"]);
      expect(columns.map((c) => c.position)).toEqual([0, 1, 2]);
      expect(columns[0].options).toEqual({ withTime: true });
      expect(columns[2].options.choices?.map((c) => c.label)).toEqual([
        "Todo",
        "Doing",
        "Done",
      ]);

      const removed = await service().applyColumnOperations(folio, [
        { op: "remove", column: "Name" },
      ]);
      expect(removed.map((c) => c.name)).toEqual(["Due", "State"]);
    });

    it("keeps an option's id when its list is restated by label", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Status", type: "select", options: { choices: ["Todo"] } },
      ]);
      const [before] = await service().columnsOf(folio.id);
      const [after] = await service().applyColumnOperations(folio, [
        {
          op: "setOptions",
          column: "Status",
          options: { choices: ["todo", "Done"] },
        },
      ]);
      expect(after.options.choices?.[0].id).toBe(
        (before.options.choices as Array<{ id: string }>)[0].id,
      );
    });

    it("refuses a duplicate name without regard to case", async ({
      expect,
    }) => {
      const folio = await createTable();
      await expect(
        service().applyColumnOperations(folio, [
          { op: "add", name: "NAME", type: "text" },
        ]),
      ).rejects.toThrow(/already has a column named/);
    });

    it("answers an unknown column with the table's columns", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Name", type: "text" },
        { name: "Due", type: "date" },
      ]);
      await expect(
        service().listRows(folio, { sort: { column: "When" } }),
      ).rejects.toThrow(/"Name", "Due"/);
    });

    it("counts the cells a retype would empty", async ({ expect }) => {
      const folio = await createTable([{ name: "Size", type: "text" }]);
      await service().addRows(folio, [
        { cells: { Size: "12" } },
        { cells: { Size: "large" } },
        { cells: {} },
      ]);
      expect(await service().cellsLostByRetype(folio, "Size", "number")).toBe(
        1,
      );
    });
  });

  describe("rows", () => {
    it("adds rows with numbers, coerces cells, and lists them in order", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Name", type: "text" },
        { name: "Count", type: "number" },
        { name: "Done", type: "checkbox" },
        { name: "Due", type: "date" },
        {
          name: "Status",
          type: "select",
          options: { choices: ["Todo", "Done"] },
        },
      ]);
      const added = await service().addRows(folio, [
        {
          cells: {
            Name: "first",
            Count: "3",
            Done: "TRUE",
            Due: "2026-11-20",
            Status: "done",
          },
        },
        { cells: { name: "second", count: 4 } },
      ]);
      expect(added.map((r) => r.number)).toEqual([1, 2]);

      const columns = await service().columnsOf(folio.id);
      const id = (name: string) => columns.find((c) => c.name === name)!.id;
      const status = columns.find((c) => c.name === "Status")!;
      const done = (
        status.options.choices as Array<{ id: string; label: string }>
      ).find((c) => c.label === "Done")!;
      expect(added[0].cells).toEqual({
        [id("Name")]: "first",
        [id("Count")]: 3,
        [id("Done")]: true,
        [id("Due")]: "2026-11-20",
        [id("Status")]: done.id,
      });

      const [middle] = await service().addRows(folio, [
        { cells: { Name: "between" }, after: 1 },
      ]);
      const listed = await service().listRows(folio);
      expect(listed.total).toBe(3);
      expect(listed.rows.map((r) => r.number)).toEqual([1, middle.number, 2]);
    });

    it("refuses a cell it cannot coerce, naming row, column and type", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Name", type: "text" },
        { name: "Count", type: "number" },
      ]);
      await expect(
        service().addRows(folio, [
          { cells: { Name: "ok" } },
          { cells: { Count: "many" } },
        ]),
      ).rejects.toThrow(
        /Row 2 of the batch, column "Count": expected a number/,
      );
      expect(await service().rowCount(folio.id)).toBe(0);
    });

    it("stores a timed date in UTC and a day as written", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "At", type: "date", options: { withTime: true } },
        { name: "Day", type: "date" },
      ]);
      const [row] = await service().addRows(folio, [
        { cells: { At: "2026-11-20T10:00:00+02:00", Day: "2026-11-21" } },
      ]);
      const columns = await service().columnsOf(folio.id);
      expect(row.cells[columns[0].id]).toBe("2026-11-20T08:00:00.000Z");
      expect(row.cells[columns[1].id]).toBe("2026-11-21");
      await expect(
        service().addRows(folio, [{ cells: { Day: "2026-11-20T10:00:00Z" } }]),
      ).rejects.toThrow(/expected a date \(YYYY-MM-DD\)/);
      await expect(
        service().addRows(folio, [{ cells: { Day: "2026-02-30" } }]),
      ).rejects.toThrow(/expected a date/);
    });

    it("validates a reference against the project", async ({ expect }) => {
      const folio = await createTable([{ name: "See", type: "reference" }]);
      const [row] = await service().addRows(folio, [
        { cells: { See: `[[#f${folio.shortId}]]` } },
      ]);
      const [column] = await service().columnsOf(folio.id);
      expect(row.cells[column.id]).toBe(`#F${folio.shortId}`);
      await expect(
        service().addRows(folio, [{ cells: { See: "#F9999" } }]),
      ).rejects.toThrow(/#F9999 does not exist in this project/);
      await expect(
        service().addRows(folio, [{ cells: { See: "#Z1" } }]),
      ).rejects.toThrow(/names no kind/);
    });

    it("updates against the row's version and answers 409 on a stale one", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Name", type: "text" },
        { name: "Note", type: "text" },
      ]);
      const [row] = await service().addRows(folio, [{ cells: { Name: "a" } }]);

      const first = await service().updateRow(
        folio,
        row.number,
        { Note: "x" },
        {
          version: row.version,
        },
      );
      expect(first.row.version).toBe(row.version + 1);
      expect(first.replaced).toEqual([]);

      await expect(
        service().updateRow(
          folio,
          row.number,
          { Note: "y" },
          {
            version: row.version,
          },
        ),
      ).rejects.toThrow(/changed since it was read/);

      const blind = await service().updateRow(folio, row.number, {
        Name: "b",
        Note: null,
      });
      expect(blind.replaced).toEqual(["Name", "Note"]);
      const columns = await service().columnsOf(folio.id);
      expect(blind.row.cells[columns[1].id]).toBeNull();
    });

    it("moves a row without rewriting the others", async ({ expect }) => {
      const folio = await createTable();
      await service().addRows(folio, [
        { cells: { Name: "a" } },
        { cells: { Name: "b" } },
        { cells: { Name: "c" } },
      ]);
      await service().moveRow(folio, 3, { before: 1 });
      await service().moveRow(folio, 1, { after: 2 });
      const listed = await service().listRows(folio);
      expect(listed.rows.map((r) => r.number)).toEqual([3, 2, 1]);
    });

    it("deletes by number, skipping numbers no row holds", async ({
      expect,
    }) => {
      const folio = await createTable();
      await service().addRows(folio, [
        { cells: { Name: "a" } },
        { cells: { Name: "b" } },
      ]);
      expect(await service().deleteRows(folio, [2, 7])).toEqual([2]);
      expect(await service().rowCount(folio.id)).toBe(1);
      const [next] = await service().addRows(folio, [{ cells: {} }]);
      expect(next.number).toBe(3);
    });

    it("filters, sorts with empty last, and pages with a total", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Name", type: "text" },
        { name: "Due", type: "date", options: { withTime: true } },
        { name: "Done", type: "checkbox" },
      ]);
      await service().addRows(folio, [
        { cells: { Name: "Alpha", Due: "2026-11-20" } },
        { cells: { Name: "beta", Due: "2026-11-18T09:00:00Z", Done: true } },
        { cells: { Name: "Gamma" } },
        { cells: { Name: "delta", Due: "2026-11-25" } },
      ]);

      const ranged = await service().listRows(folio, {
        where: [{ column: "Due", from: "2026-11-18", to: "2026-11-20" }],
        sort: { column: "Due" },
      });
      expect(ranged.rows.map((r) => r.number)).toEqual([2, 1]);

      const sorted = await service().listRows(folio, {
        sort: { column: "Due", direction: "desc" },
      });
      expect(sorted.rows.map((r) => r.number)).toEqual([4, 1, 2, 3]);

      const empty = await service().listRows(folio, {
        where: [{ column: "Due", isEmpty: true }],
      });
      expect(empty.rows.map((r) => r.number)).toEqual([3]);

      const text = await service().listRows(folio, {
        where: [{ column: "name", contains: "A" }],
        limit: 2,
        offset: 1,
      });
      expect(text.total).toBe(4);
      expect(text.rows.map((r) => r.number)).toEqual([2, 3]);

      const done = await service().listRows(folio, {
        where: [{ column: "Done", equals: "true" }],
      });
      expect(done.rows.map((r) => r.number)).toEqual([2]);
    });
  });

  describe("lenient reads", () => {
    it("reads a cell that no longer fits its retyped column as empty", async ({
      expect,
    }) => {
      const folio = await createTable([{ name: "Size", type: "text" }]);
      await service().addRows(folio, [
        { cells: { Size: "12" } },
        { cells: { Size: "large" } },
      ]);
      const [column] = await service().applyColumnOperations(folio, [
        { op: "retype", column: "Size", type: "number" },
      ]);
      const listed = await service().listRows(folio);
      expect(listed.rows.map((r) => r.cells[column.id])).toEqual([12, null]);
    });

    it("reads a removed option as empty and never fails the row", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Name", type: "text" },
        {
          name: "Status",
          type: "select",
          options: { choices: ["Todo", "Done"] },
        },
      ]);
      await service().addRows(folio, [
        { cells: { Name: "a", Status: "Done" } },
      ]);
      const columns = await service().applyColumnOperations(folio, [
        { op: "setOptions", column: "Status", options: { choices: ["Todo"] } },
      ]);
      const [row] = (await service().listRows(folio)).rows;
      expect(row.cells[columns[0].id]).toBe("a");
      expect(row.cells[columns[1].id]).toBeNull();
    });

    it("ignores a removed column's key and drops it on the next write", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Name", type: "text" },
        { name: "Old", type: "text" },
      ]);
      await service().addRows(folio, [{ cells: { Name: "a", Old: "gone" } }]);
      const oldId = (await service().columnsOf(folio.id))[1].id;
      await service().applyColumnOperations(folio, [
        { op: "remove", column: "Old" },
      ]);
      const [listed] = (await service().listRows(folio)).rows;
      expect(Object.keys(listed.cells)).not.toContain(oldId);

      await service().updateRow(folio, 1, { Name: "b" });
      const [stored] = await tables.rows.findMany({
        where: { folioId: { eq: folio.id } },
      });
      expect(Object.keys(stored.cells)).not.toContain(oldId);
      expect(stored.searchText).toBe("b");
    });

    it("reads a stored value of the wrong shape as empty", async ({
      expect,
    }) => {
      const folio = await createTable([{ name: "Count", type: "number" }]);
      const [column] = await service().columnsOf(folio.id);
      await tables.rows.create({
        folioId: folio.id,
        number: 1,
        position: 1,
        cells: { [column.id]: { nested: true } },
      });
      const [row] = (await service().listRows(folio)).rows;
      expect(row.cells[column.id]).toBeNull();
    });
  });

  describe("caps", () => {
    it("refuses a 51st column", async ({ expect }) => {
      const folio = await createTable(
        Array.from({ length: 50 }, (_, i) => ({
          name: `C${i}`,
          type: "text" as const,
        })),
      );
      await expect(
        service().applyColumnOperations(folio, [
          { op: "add", name: "One more", type: "text" },
        ]),
      ).rejects.toThrow(/at most 50 columns/);
    });

    it("refuses a 2,001st row", async ({ expect }) => {
      const folio = await createTable();
      for (let i = 0; i < 20; i += 1) {
        await service().addRows(
          folio,
          Array.from({ length: 100 }, () => ({ cells: {} })),
        );
      }
      await expect(service().addRows(folio, [{ cells: {} }])).rejects.toThrow(
        /at most 2000 rows/,
      );
    });

    it("refuses a text cell over 2,000 characters and a batch over 100", async ({
      expect,
    }) => {
      const folio = await createTable();
      await expect(
        service().addRows(folio, [{ cells: { Name: "x".repeat(2001) } }]),
      ).rejects.toThrow(/at most 2000 characters \(got 2001\)/);
      await expect(
        service().addRows(
          folio,
          Array.from({ length: 101 }, () => ({ cells: {} })),
        ),
      ).rejects.toThrow(/1 to 100 at a time/);
    });

    it("refuses a 51st option", async ({ expect }) => {
      const folio = await createTable();
      await expect(
        service().applyColumnOperations(folio, [
          {
            op: "add",
            name: "Pick",
            type: "select",
            options: {
              choices: Array.from({ length: 51 }, (_, i) => `o${i}`),
            },
          },
        ]),
      ).rejects.toThrow(/at most 50 options/);
    });
  });

  describe("search text", () => {
    it("indexes a select by its label and skips a checkbox", async ({
      expect,
    }) => {
      const folio = await createTable([
        { name: "Name", type: "text" },
        { name: "Status", type: "select", options: { choices: ["In Review"] } },
        { name: "Done", type: "checkbox" },
      ]);
      await service().addRows(folio, [
        { cells: { Name: "Fix", Status: "in review", Done: true } },
      ]);
      const [stored] = await tables.rows.findMany({
        where: { folioId: { eq: folio.id } },
      });
      expect(stored.searchText).toBe("fix in review");

      await service().applyColumnOperations(folio, [
        {
          op: "setOptions",
          column: "Status",
          options: {
            choices: [
              {
                id: (stored.cells as Record<string, string>)[
                  (await service().columnsOf(folio.id))[1].id
                ],
                label: "Reviewing",
              },
            ],
          },
        },
      ]);
      const [reindexed] = await tables.rows.findMany({
        where: { folioId: { eq: folio.id } },
      });
      expect(reindexed.searchText).toBe("fix reviewing");
      expect(reindexed.version).toBe(stored.version);
    });
  });
});
