import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  FolioController,
  FolioTableController,
  FolioTableService,
  LoreRememberApi,
} from "../src/api/index.ts";
import { FolioTableTools, LoreRememberMcp } from "../src/mcp/index.ts";

/**
 * The calendar's server half (#E144, #Q3518): the view a folio remembers,
 * read leniently, its kind from the folio's type (#Q3717), and the agenda
 * an agent reads with `folio_row_list`.
 */
describe("table folio views", () => {
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
        .createProject.fetch({ body: { title: "Views" } }, { user: owner })
    ).data.id;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const createFolio = async (
    type: "table" | "calendar",
    columns?: Array<{
      name: string;
      type: "text" | "date";
      options?: { withTime?: boolean };
    }>,
  ) =>
    (
      await alepha.inject(FolioController).create.fetch(
        {
          body: {
            projectId,
            title: "Goals",
            type,
            ...(columns ? { columns } : {}),
          },
        },
        { user: owner },
      )
    ).data;

  const createTable = async (
    columns: Array<{
      name: string;
      type: "text" | "date";
      options?: { withTime?: boolean };
    }>,
  ) => createFolio("table", columns);

  it("reads a table as a grid and a calendar as a month, by the folio's type (#Q3717)", async ({
    expect,
  }) => {
    const tables = alepha.inject(FolioTableController);
    const table = await createTable([
      { name: "Goal", type: "text" },
      { name: "Due", type: "date" },
    ]);
    const grid = (
      await tables.getFolioTable.fetch(
        { params: { id: table.id }, query: {} },
        { user: owner },
      )
    ).data;
    expect(grid.view.kind).toBe("grid");
    expect(grid.view.dateColumnId).toBe(grid.columns[1].id);
    expect(grid.view.titleColumnId).toBe(grid.columns[0].id);

    // A calendar created without columns starts on Title and Date.
    const calendar = await createFolio("calendar");
    expect(calendar.type).toBe("calendar");
    const month = (
      await tables.getFolioTable.fetch(
        { params: { id: calendar.id }, query: {} },
        { user: owner },
      )
    ).data;
    expect(month.columns.map((c) => [c.name, c.type])).toEqual([
      ["Title", "text"],
      ["Date", "date"],
    ]);
    expect(month.view).toMatchObject({
      kind: "calendar",
      dateColumnId: month.columns[1].id,
      titleColumnId: month.columns[0].id,
    });

    // The stored view picks columns, never the kind, and refuses a
    // non-date column for the date.
    await expect(
      tables.setFolioView.fetch(
        {
          params: { id: calendar.id },
          body: { dateColumnId: month.columns[0].id },
        },
        { user: owner },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("falls back to the first date column, then to the grid", async ({
    expect,
  }) => {
    const folio = await createFolio("calendar", [
      { name: "Goal", type: "text" },
      { name: "Start", type: "date" },
      { name: "End", type: "date" },
    ]);
    const service = alepha.inject(FolioTableService);
    const columns = await service.columnsOf(folio.id);
    await service.setView(folio, { dateColumnId: columns[2].id });
    await service.applyColumnOperations(folio, [
      { op: "remove", column: "End" },
    ]);
    expect(await service.viewOf(folio)).toMatchObject({
      kind: "calendar",
      dateColumnId: columns[1].id,
    });
    await service.applyColumnOperations(folio, [
      { op: "remove", column: "Start" },
    ]);
    const view = await service.viewOf(folio);
    expect(view.kind).toBe("grid");
    expect(view.dateColumnId).toBeUndefined();
  });

  it("answers the agenda: rows between two dates, by date, day-only and timed mixed", async ({
    expect,
  }) => {
    const folio = await createTable([
      { name: "Goal", type: "text" },
      { name: "Due", type: "date", options: { withTime: true } },
    ]);
    await alepha.inject(FolioTableController).addFolioRows.fetch(
      {
        params: { id: folio.id },
        body: {
          rows: [
            { cells: { Goal: "late", Due: "2026-12-02" } },
            { cells: { Goal: "noon", Due: "2026-11-20T12:00:00Z" } },
            { cells: { Goal: "day", Due: "2026-11-20" } },
            { cells: { Goal: "early", Due: "2026-11-03T08:00:00Z" } },
            { cells: { Goal: "none" } },
          ],
        },
      },
      { user: owner },
    );
    const agenda = await alepha.context.run(async () => {
      alepha.store.set(currentUserAtom, owner);
      return (alepha.inject(FolioTableTools).folio_row_list as any).execute({
        project: projectId,
        shortId: folio.shortId,
        where: [{ column: "due", from: "2026-11-01", to: "2026-11-30" }],
        sort: "Due",
      });
    });
    expect(agenda.total).toBe(3);
    expect(
      agenda.rows.map((r: { cells: { Goal: string } }) => r.cells.Goal),
    ).toEqual(["early", "day", "noon"]);
  });
});
