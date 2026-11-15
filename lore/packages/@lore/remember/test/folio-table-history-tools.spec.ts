import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { folios } from "../src/api/entities/folios.ts";
import {
  FolioHistoryService,
  FolioTableService,
  LoreRememberApi,
} from "../src/api/index.ts";
import { FolioTools, LoreRememberMcp } from "../src/mcp/index.ts";

class FolioRepo {
  folios = $repository(folios);
}

/**
 * `folio_history` and `folio_revert` on a table folio (#E144, #Q3513): the
 * tools call the same actions, which know a table's body is its rows.
 */
describe("Lore MCP: table folio history", () => {
  it("lists a table's revisions and reverts to one", async ({ expect }) => {
    const alepha = Alepha.create({
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
    const tools = alepha.inject(FolioTools);
    const repo = alepha.inject(FolioRepo);
    await alepha.start();

    const owner = await alepha
      .inject(UserService)
      .createUser({ username: "owner" });
    const asOwner = <R>(fn: () => R): R =>
      alepha.context.run(() => {
        alepha.store.set(currentUserAtom, { id: owner.id, roles: ["user"] });
        return fn();
      });
    const project = await asOwner(() =>
      alepha
        .inject(ProjectController)
        .createProject({ body: { title: "Tables" } }),
    );
    const folio = await repo.folios.create({
      projectId: project.id,
      shortId: 1,
      title: "Hosting",
      type: "table",
    });
    const tables = alepha.inject(FolioTableService);
    await tables.seedColumns(folio, [{ name: "Host", type: "text" }]);
    await alepha
      .inject(FolioHistoryService)
      .recordRevision(folio, owner.id, { action: "create", first: true });
    await alepha.inject(DateTimeProvider).travel(2 * 60 * 60 * 1000);
    await tables.addRows(folio, [{ cells: { Host: "a" } }], owner.id);

    const history = await asOwner(() =>
      (tools.folio_history as any).execute({
        project: project.id,
        shortId: folio.shortId,
      }),
    );
    expect(history.revisions.map((r: { action: string }) => r.action)).toEqual([
      "edit",
      "create",
    ]);
    const created = history.revisions[1];
    expect(tables.decodeSnapshot(created.contentSnapshot)?.rows).toEqual([]);
    expect(
      tables.decodeSnapshot(history.revisions[0].contentSnapshot)?.rows,
    ).toHaveLength(1);

    await asOwner(() =>
      (tools.folio_revert as any).execute({
        project: project.id,
        shortId: folio.shortId,
        revisionId: created.id,
      }),
    );
    expect(await tables.rowCount(folio.id)).toBe(0);
    await alepha.stop();
  });
});
