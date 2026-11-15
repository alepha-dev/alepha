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
 * read leniently, and the agenda an agent reads with `folio_row_list`.
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

  const createTable = async (
    columns: Array<{
      name: string;
      type: "text" | "date";
      options?: { withTime?: boolean };
    }>,
  ) =>
    (
      await alepha
        .inject(FolioController)
        .create.fetch(
          { body: { projectId, title: "Goals", type: "table", columns } },
          { user: owner },
        )
    ).data;

  it("reads as a grid until a calendar is chosen, and remembers it", async ({
    expect,
  }) => {
    const folio = await createTable([
      { name: "Goal", type: "text" },
      { name: "Due", type: "date" },
    ]);
    const tables = alepha.inject(FolioTableController);
    const first = (
      await tables.getFolioTable.fetch(
        { params: { id: folio.id }, query: {} },
        { user: owner },
      )
    ).data;
    expect(first.view.kind).toBe("grid");
    const due = first.columns[1].id;
    expect(first.view.dateColumnId).toBe(due);
    expect(first.view.titleColumnId).toBe(first.columns[0].id);

    await tables.setFolioView.fetch(
      { params: { id: folio.id }, body: { kind: "calendar" } },
      { user: owner },
    );
    const read = (
      await tables.getFolioTable.fetch(
        { params: { id: folio.id }, query: {} },
        { user: owner },
      )
    ).data;
    expect(read.view).toMatchObject({ kind: "calendar", dateColumnId: due });

    await expect(
      tables.setFolioView.fetch(
        {
          params: { id: folio.id },
          body: { kind: "calendar", dateColumnId: first.columns[0].id },
        },
        { user: owner },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("falls back to the first date column, then to the grid", async ({
    expect,
  }) => {
    const folio = await createTable([
      { name: "Goal", type: "text" },
      { name: "Start", type: "date" },
      { name: "End", type: "date" },
    ]);
    const service = alepha.inject(FolioTableService);
    const columns = await service.columnsOf(folio.id);
    await service.setView(folio, {
      kind: "calendar",
      dateColumnId: columns[2].id,
    });
    await service.applyColumnOperations(folio, [
      { op: "remove", column: "End" },
    ]);
    expect(await service.viewOf(folio.id)).toMatchObject({
      kind: "calendar",
      dateColumnId: columns[1].id,
    });
    await service.applyColumnOperations(folio, [
      { op: "remove", column: "Start" },
    ]);
    const view = await service.viewOf(folio.id);
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
