import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { folioRows } from "../src/api/entities/folioRows.ts";
import {
  FolioTableService,
  type FolioTableTarget,
  LoreRememberApi,
} from "../src/api/index.ts";
import {
  createTestFolio,
  createTestProject,
  KnowledgeTestEntities,
} from "../src/testing/index.ts";

class Rows {
  rows = $repository(folioRows);
}

/**
 * A table's byte budget (#Q3708): every row carries its size, the table's
 * total is one aggregate, and a write that would take it past 1.5 MB is
 * refused unless it shrinks the table.
 *
 * Measured at the real budget: 50 text columns of 2,000 characters make a
 * row of about 102 KB, so fourteen full rows sit under 1.5 MB and the
 * fifteenth is past it.
 */
describe("FolioTableService byte budget", () => {
  let alepha: Alepha;
  let repos: Rows;

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
    // The fixtures' repositories, registered before the container locks.
    alepha.inject(KnowledgeTestEntities);
    repos = alepha.inject(Rows);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const service = () => alepha.inject(FolioTableService);
  const columns = Array.from({ length: 50 }, (_, i) => ({
    name: `C${i}`,
    type: "text" as const,
  }));
  const full = (letter = "x") =>
    Object.fromEntries(columns.map((c) => [c.name, letter.repeat(2000)]));

  const createTable = async (): Promise<FolioTableTarget> => {
    const project = await createTestProject(alepha);
    const folio = await createTestFolio(alepha, project, { type: "table" });
    await service().seedColumns(folio, columns);
    return folio;
  };

  /**
   * Fourteen full rows: under the budget, with less than one full row left.
   */
  const nearlyFull = async () => {
    const folio = await createTable();
    await service().addRows(
      folio,
      Array.from({ length: 14 }, () => ({ cells: full() })),
    );
    return folio;
  };

  it("writes every row's size, and reads the total as one aggregate", async ({
    expect,
  }) => {
    const folio = await createTable();
    await service().addRows(folio, [
      { cells: { C0: "short" } },
      { cells: { C1: "é".repeat(10) } },
    ]);
    const stored = await repos.rows.findMany({
      where: { folioId: { eq: folio.id } },
    });
    for (const row of stored) {
      expect(row.bytes).toBe(service().bytesOf(row.cells));
    }

    const reads: string[] = [];
    const off = alepha.events.on("repository:read:before", (event) => {
      reads.push((event as { tableName: string }).tableName);
    });
    const total = await service().tableBytes(folio.id);
    off();
    expect(total).toBe(stored.reduce((sum, row) => sum + row.bytes, 0));
    expect(reads).toEqual(["folio_rows"]);
  });

  it("refuses an add past 1.5 MB, saying the size, the addition and the budget", async ({
    expect,
  }) => {
    const folio = await nearlyFull();
    expect(await service().tableBytes(folio.id)).toBeLessThan(
      FolioTableService.MAX_TABLE_BYTES,
    );
    await expect(service().addRows(folio, [{ cells: full() }])).rejects.toThrow(
      /at most 1,500 KB of cells.*holds 1,4\d\d KB.*adds 10\d KB/,
    );
    expect(await service().rowCount(folio.id)).toBe(14);
  });

  it("refuses an update that grows a row past the budget, never one that shrinks it, nor a delete", async ({
    expect,
  }) => {
    const folio = await nearlyFull();
    await service().addRows(folio, [{ cells: { C0: "small" } }]);

    await expect(service().updateRow(folio, 15, full())).rejects.toThrow(
      /at most 1,500 KB/,
    );

    // Shortening a full row always lands, and so does a delete.
    await service().updateRow(folio, 1, { C0: "now short" });
    await service().deleteRows(folio, [2]);
    const after = await service().tableBytes(folio.id);
    expect(after).toBeLessThan(13 * 102_000);

    // The room the trim made is usable again.
    await service().updateRow(folio, 15, full("y"));
  });

  it("refuses a revert that would end past the budget and larger than now, and allows one that shrinks", async ({
    expect,
  }) => {
    const folio = await nearlyFull();
    const { columns: stored, rows } = await service().snapshot(folio.id);
    const data = {
      v: 1 as const,
      columns: stored.map((column) => ({
        id: column.id,
        position: column.position,
        name: column.name,
        type: column.type,
        options: column.options ?? {},
      })),
      rows: rows.map((row) => ({
        id: row.id,
        number: row.number,
        position: row.position,
        cells: row.cells,
      })),
    };
    const bigger = {
      ...data,
      rows: [
        ...data.rows,
        { ...data.rows[0], id: crypto.randomUUID(), number: 99, position: 99 },
      ],
    };
    await expect(service().restoreSnapshot(folio, bigger)).rejects.toThrow(
      /at most 1,500 KB/,
    );

    const smaller = { ...data, rows: data.rows.slice(0, 3) };
    await service().restoreSnapshot(folio, smaller);
    expect(await service().rowCount(folio.id)).toBe(3);
    expect(await service().tableBytes(folio.id)).toBe(
      smaller.rows.reduce((sum, row) => sum + service().bytesOf(row.cells), 0),
    );
  });

  it("drops a removed column's cells from the rows' sizes", async ({
    expect,
  }) => {
    const folio = await createTable();
    await service().addRows(folio, [{ cells: { C0: "a".repeat(500) } }]);
    const before = await service().tableBytes(folio.id);
    await service().applyColumnOperations(folio, [
      { op: "remove", column: "C0" },
    ]);
    expect(await service().tableBytes(folio.id)).toBeLessThan(before - 400);
  });
});
