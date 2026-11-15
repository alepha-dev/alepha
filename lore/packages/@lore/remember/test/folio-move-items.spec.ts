import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  FolioController,
  FolioDirectoryService,
  LoreRememberApi,
} from "../src/api/index.ts";

/**
 * Moving a selection in one request (#Q3697): the tree's multi-row drop.
 */
describe("moveFolioItems", () => {
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
    alepha.with(LoreRememberApi);
    await alepha.start();
    const user = await alepha
      .inject(UserService)
      .createUser({ username: "owner" });
    owner = { id: user.id, roles: ["user"] };
    projectId = (
      await alepha
        .inject(ProjectController)
        .createProject.fetch({ body: { title: "Moves" } }, { user: owner })
    ).data.id;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const folios = () => alepha.inject(FolioController);
  const directories = () => alepha.inject(FolioDirectoryService);

  const folio = async (title: string, directoryId?: string) =>
    (
      await folios().create.fetch(
        { body: { projectId, title, content: "x", directoryId } },
        { user: owner },
      )
    ).data;

  const move = (body: {
    folioIds: string[];
    directoryIds: string[];
    parentId: string | null;
  }) =>
    folios().moveFolioItems.fetch(
      { body: { projectId, ...body } },
      { user: owner },
    );

  it("moves twenty folios and a directory in one request, suffixing a taken title", async ({
    expect,
  }) => {
    const target = await directories().create({ projectId, name: "Target" });
    const other = await directories().create({ projectId, name: "Other" });
    const many: Array<{ id: string }> = [];
    for (let i = 0; i < 20; i += 1) many.push(await folio(`Note ${i}`));
    // A folio of the same title already in the target: the moved one is
    // suffixed, as a single move does.
    await folio("Note 0", target.id);

    const answer = (
      await move({
        folioIds: many.map((f) => f.id),
        directoryIds: [other.id],
        parentId: target.id,
      })
    ).data;

    expect(answer.folios).toHaveLength(20);
    expect(answer.directories).toEqual([
      { id: other.id, name: "Other", parentId: target.id },
    ]);
    expect(answer.folios.every((f) => f.directoryId === target.id)).toBe(true);
    expect(answer.folios.find((f) => f.id === many[0].id)?.title).not.toBe(
      "Note 0",
    );
  });

  it("leaves rows already in the target alone, and moves to the root with null", async ({
    expect,
  }) => {
    const dir = await directories().create({ projectId, name: "Dir" });
    const inside = await folio("Inside", dir.id);
    const outside = await folio("Outside");

    const answer = (
      await move({
        folioIds: [inside.id, outside.id],
        directoryIds: [],
        parentId: dir.id,
      })
    ).data;
    expect(answer.folios.map((f) => f.id)).toEqual([outside.id]);

    const back = (
      await move({ folioIds: [inside.id], directoryIds: [], parentId: null })
    ).data;
    expect(back.folios).toEqual([
      { id: inside.id, title: "Inside", directoryId: undefined },
    ]);
  });

  it("refuses a directory dropped into itself", async ({ expect }) => {
    const dir = await directories().create({ projectId, name: "Dir" });
    await expect(
      move({ folioIds: [], directoryIds: [dir.id], parentId: dir.id }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
