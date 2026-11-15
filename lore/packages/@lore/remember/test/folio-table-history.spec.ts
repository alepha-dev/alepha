import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { folioRevisions } from "../src/api/entities/folioRevisions.ts";
import { folioRows } from "../src/api/entities/folioRows.ts";
import type { Folio } from "../src/api/entities/folios.ts";
import {
  FolioController,
  FolioHistoryService,
  FolioTableService,
  LoreRememberApi,
} from "../src/api/index.ts";
import {
  createTestFolio,
  createTestProject,
  KnowledgeTestEntities,
} from "../src/testing/index.ts";

class RevisionRepo {
  revisions = $repository(folioRevisions);
  rows = $repository(folioRows);
}

/**
 * Table folios have history (#E144, #Q3513): a revision snapshots columns
 * and rows per writing session, and revert restores them.
 */
describe("table folio history", () => {
  const hour = 60 * 60 * 1000;
  let alepha: Alepha;
  let repo: RevisionRepo;

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
    alepha.inject(KnowledgeTestEntities);
    repo = alepha.inject(RevisionRepo);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const tables = () => alepha.inject(FolioTableService);

  /**
   * A table folio, its owner, and its `create` revision, as
   * `FolioController.create` leaves them.
   */
  const createTable = async (): Promise<{ folio: Folio; userId: string }> => {
    const project = await createTestProject(alepha);
    const userId = project.createdBy!;
    const folio = await createTestFolio(alepha, project, {
      type: "table",
      title: "Hosting",
    });
    await tables().seedColumns(folio, [
      { name: "Host", type: "text" },
      { name: "Price", type: "number" },
    ]);
    await alepha
      .inject(FolioHistoryService)
      .recordRevision(folio, userId, { action: "create", first: true });
    return { folio, userId };
  };

  const revisionsOf = (folioId: string) =>
    repo.revisions.findMany({
      where: { folioId: { eq: folioId } },
      orderBy: [{ column: "at", direction: "asc" }],
    });

  const member = (userId: string) => ({ id: userId, roles: ["user"] });

  it("folds row and column writes into one revision per session", async ({
    expect,
  }) => {
    const { folio, userId } = await createTable();
    await tables().addRows(folio, [{ cells: { Host: "a" } }], userId);
    await tables().updateRow(folio, 1, { Price: 3 }, { userId });
    await tables().applyColumnOperations(
      folio,
      [{ op: "add", name: "Region", type: "text" }],
      userId,
    );

    const revisions = await revisionsOf(folio.id);
    expect(revisions.map((r) => r.action)).toEqual(["create"]);
    expect(revisions[0].snapshotIsLive).toBe(true);
  });

  it("fills the previous head with the table as it stood before the write that opens a new revision", async ({
    expect,
  }) => {
    const { folio, userId } = await createTable();
    await tables().addRows(folio, [{ cells: { Host: "a", Price: 1 } }], userId);
    await alepha.inject(DateTimeProvider).travel(2 * hour);

    await tables().addRows(folio, [{ cells: { Host: "b" } }], userId);

    const [first, second] = await revisionsOf(folio.id);
    expect(second.action).toBe("edit");
    expect(second.snapshotIsLive).toBe(true);
    expect(first.snapshotIsLive).toBe(false);
    const before = tables().decodeSnapshot(first.contentSnapshot)!;
    expect(before.v).toBe(1);
    expect(before.columns.map((c) => c.name)).toEqual(["Host", "Price"]);
    expect(before.rows.map((r) => r.number)).toEqual([1]);
  });

  it("reads a corrupt or unknown snapshot as undefined, never a throw", async ({
    expect,
  }) => {
    expect(tables().decodeSnapshot("{not json")).toBeUndefined();
    expect(tables().decodeSnapshot("")).toBeUndefined();
    expect(
      tables().decodeSnapshot(JSON.stringify({ v: 2, columns: [], rows: [] })),
    ).toBeUndefined();
    const lenient = tables().decodeSnapshot(
      JSON.stringify({
        v: 1,
        columns: [{ id: "c", position: 0, name: "A", type: "text" }, { id: 3 }],
        rows: [
          { id: "r", number: 1, position: 1, cells: null },
          { number: -1 },
        ],
      }),
    );
    expect(lenient?.columns.map((c) => c.id)).toEqual(["c"]);
    expect(lenient?.rows).toEqual([
      { id: "r", number: 1, position: 1, cells: {} },
    ]);
  });

  it("lists a table's history with a corrupt snapshot in it, and refuses to revert to it", async ({
    expect,
  }) => {
    const { folio, userId } = await createTable();
    await alepha.inject(DateTimeProvider).travel(2 * hour);
    await tables().addRows(folio, [{ cells: { Host: "a" } }], userId);
    const [first] = await revisionsOf(folio.id);
    await repo.revisions.updateById(first.id, { contentSnapshot: "{broken" });

    const controller = alepha.inject(FolioController);
    const history = await controller.listHistory.fetch(
      { params: { id: folio.id } },
      { user: member(userId) },
    );
    expect(history.data).toHaveLength(2);
    expect(
      tables().decodeSnapshot(history.data[0].contentSnapshot)?.rows,
    ).toHaveLength(1);

    await expect(
      controller.revertHistory.fetch(
        { params: { id: folio.id, revisionId: first.id } },
        { user: member(userId) },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect((await tables().listRows(folio)).total).toBe(1);
  });

  it("reverts columns and rows, writes a revert revision, and never reuses a row number", async ({
    expect,
  }) => {
    const { folio, userId } = await createTable();
    await tables().addRows(
      folio,
      [{ cells: { Host: "a", Price: 1 } }, { cells: { Host: "b", Price: 2 } }],
      userId,
    );
    await alepha.inject(DateTimeProvider).travel(2 * hour);
    await tables().deleteRows(folio, [1], userId);
    await tables().applyColumnOperations(
      folio,
      [
        { op: "remove", column: "Price" },
        { op: "add", name: "Region", type: "text" },
      ],
      userId,
    );
    await tables().addRows(folio, [{ cells: { Host: "c" } }], userId);

    const [create] = await revisionsOf(folio.id);
    const controller = alepha.inject(FolioController);
    await controller.revertHistory.fetch(
      { params: { id: folio.id, revisionId: create.id } },
      { user: member(userId) },
    );

    const restored = await tables().listRows(folio);
    expect(restored.columns.map((c) => c.name)).toEqual(["Host", "Price"]);
    expect(restored.rows.map((r) => r.number)).toEqual([1, 2]);
    const price = restored.columns[1].id;
    expect(restored.rows.map((r) => r.cells[price])).toEqual([1, 2]);

    const revisions = await revisionsOf(folio.id);
    expect(revisions.map((r) => r.action)).toEqual([
      "create",
      "edit",
      "revert",
    ]);
    // The state reverted from stays in history.
    const reverted = tables().decodeSnapshot(revisions[1].contentSnapshot)!;
    expect(reverted.columns.map((c) => c.name)).toEqual(["Host", "Region"]);
    expect(reverted.rows.map((r) => r.number)).toEqual([2, 3]);

    const [next] = await tables().addRows(folio, [{ cells: {} }], userId);
    expect(next.number).toBe(4);
  });

  it("keeps a worst-case table's snapshot well under D1's 2 MB value limit", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const folio = await createTestFolio(alepha, project, { type: "table" });
    await tables().seedColumns(folio, [
      { name: "Title", type: "text" },
      { name: "Notes", type: "text" },
      { name: "Amount", type: "number" },
      { name: "Due", type: "date", options: { withTime: true } },
      { name: "Done", type: "checkbox" },
      {
        name: "Status",
        type: "select",
        options: { choices: ["Todo", "Done"] },
      },
    ]);
    for (let batch = 0; batch < 20; batch += 1) {
      await tables().addRows(
        folio,
        Array.from({ length: 100 }, (_, i) => ({
          cells: {
            Title: `Row ${batch * 100 + i} ${"t".repeat(40)}`,
            Notes: "n".repeat(120),
            Amount: batch * 100 + i,
            Due: "2026-11-20T10:00:00Z",
            Done: i % 2 === 0,
            Status: "Todo",
          },
        })),
      );
    }

    const snapshot = await tables().encodeSnapshot(folio.id);
    const bytes = new TextEncoder().encode(snapshot).length;
    // Measured 1,139,355 bytes (#Q3513).
    expect(bytes).toBeLessThan(FolioTableService.MAX_SNAPSHOT_BYTES);
    expect(tables().decodeSnapshot(snapshot)?.rows).toHaveLength(2000);
  });

  it("records a table too large to snapshot as such, and still writes", async ({
    expect,
  }) => {
    const { folio, userId } = await createTable();
    const columns = await tables().applyColumnOperations(
      folio,
      Array.from({ length: 2 }, (_, i) => ({
        op: "add" as const,
        name: `Long ${i}`,
        type: "text" as const,
      })),
    );
    // A table this size cannot be written any more (#Q3708): the rows go in
    // straight, as a table written before the byte budget would hold them.
    // `tooLarge` stays as the net for it.
    const [long0, long1] = columns.slice(-2).map((column) => column.id);
    const cells = { [long0]: "x".repeat(2000), [long1]: "y".repeat(2000) };
    await repo.rows.createMany(
      Array.from({ length: 500 }, (_, i) => ({
        folioId: folio.id,
        // Clear of the numbers the row sequence hands out next.
        number: 1000 + i,
        position: i + 1,
        cells,
      })),
    );
    await alepha.inject(DateTimeProvider).travel(2 * hour);

    await tables().addRows(folio, [{ cells: { Host: "after" } }], userId);

    const [first] = await revisionsOf(folio.id);
    expect(first.snapshotIsLive).toBe(false);
    expect(JSON.parse(first.contentSnapshot)).toMatchObject({ tooLarge: true });
    expect(tables().decodeSnapshot(first.contentSnapshot)).toBeUndefined();
    expect(await tables().rowCount(folio.id)).toBe(501);
  });
});
