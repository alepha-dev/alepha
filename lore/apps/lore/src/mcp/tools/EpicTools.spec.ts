import { Alepha, AlephaError } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer, NotFoundError } from "alepha/server";
import { describe, it } from "vitest";

import {
  createTestEpic,
  createTestFolio,
  createTestQuest,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { EpicController } from "../../api/controllers/EpicController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { members } from "../../api/entities/members.ts";
import { LoreApi } from "../../api/index.ts";
import { LoreMcp } from "../index.ts";
import { EpicTools } from "./EpicTools.ts";
import { FolioTools } from "./FolioTools.ts";
import { ProjectTools } from "./ProjectTools.ts";
import { QuestTools } from "./QuestTools.ts";

/**
 * `members` is not part of `TestEntityRepositories` — this is the only spec
 * in this file that needs a non-owner project member. `ProjectController`
 * (already injected pre-`start()` below) has its own `members =
 * $repository(members)` field, which is what actually registers the table
 * in the FK closure; this class just gets a typed handle onto the same
 * table for direct inserts, the same shape as `insights-controller.spec.ts`
 * / `folio-permissions.spec.ts`'s `addMember` helpers.
 */
class MembersProbe {
  members = $repository(members);
}

/**
 * An `EpicController` whose attach always fails.
 *
 * The refusal the partial-write guards below need used to come free from
 * authorization: `attachQuest` / `attachFolio` were owner-only while
 * `quest_create` / `folio_create` needed membership, so a non-owner member
 * reached the attach and was refused. Epic mutations are member-gated now
 * (an epic groups quests and folios, both of which a member already
 * creates), so that path succeeds and can no longer produce the failure.
 *
 * What those guards are about is the COMPENSATION, not the gate: an attach
 * that fails for ANY reason must not leave a half-written row behind.
 * Injecting the failure is what keeps them alive independently of who is
 * allowed to attach — and substituting the service is how this codebase
 * mocks, `vi.mock` being banned.
 *
 * The two `$action` fields are replaced by plain async functions. Nothing
 * here calls them over HTTP — the MCP tools invoke the method directly —
 * so losing their route registration costs this spec nothing.
 */
class FailingAttachEpicController extends EpicController {
  attachQuest = (async () => {
    throw new AlephaError("attach refused");
  }) as unknown as EpicController["attachQuest"];

  attachFolio = (async () => {
    throw new AlephaError("attach refused");
  }) as unknown as EpicController["attachFolio"];
}

/**
 * The epic surface over MCP, plus the gap it closes: Task 2 made the
 * backlog gate default-on inside `QuestController.getQuests`, and
 * `QuestTools.quest_list` called that same action — so before this file,
 * MCP `quest_list` was gated too, contradicting spec §5.3. That asymmetry
 * is deliberate the other way: the human's backlog stays clean, but an
 * agent that files a quest into a planned epic must see it in its own next
 * `quest_list` call, or the tool looks as though it silently failed.
 *
 * Pinned, like every other lore spec: the ROOT vitest config — the one CI
 * runs — sets `DATABASE_URL` to a Postgres URL, which this app's SQLite
 * provider rejects outright. A bare `Alepha.create()` passes under
 * `yarn w lore test` and fails under `yarn test`.
 */
const setup = async (options: { failEpicAttach?: boolean } = {}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  if (options.failEpicAttach) {
    alepha.with({
      provide: EpicController,
      use: FailingAttachEpicController,
    });
  }
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const repos = alepha.inject(TestEntityRepositories);
  const membersProbe = alepha.inject(MembersProbe);
  const epicTools = alepha.inject(EpicTools);
  const questTools = alepha.inject(QuestTools);
  const folioTools = alepha.inject(FolioTools);
  const projectTools = alepha.inject(ProjectTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  // A real user row: membership carries a foreign key to it, so a made-up id
  // fails the constraint rather than the authorization check.
  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  /*
    Runs a tool the way the transport does.

    `execute()` is the entry point, and the caller's identity does NOT
    travel as an argument — the controllers behind these tools read it from
    the request context. So the call has to happen inside one, with the
    user seeded exactly where `$secure` looks.
  */
  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  // Created through the controller, not by inserting a row: ownership lives
  // in a membership record, and `resolveProjectId` looks the project up
  // among the ones the caller belongs to. A bare row is a project nobody
  // owns.
  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  /**
   * A member with no owner bit set — direct repo insert, bypassing the
   * invitation flow (same as `insights-controller.spec.ts` /
   * `folio-permissions.spec.ts`'s `addMember` helpers). `resolveProjectId`
   * needs `getMyProjects` to list this project for the member to reach any
   * tool at all, which is what the membership row buys.
   */
  const addNonOwnerMember = async (): Promise<string> => {
    const member = await users.createUser({
      username: `member-${crypto.randomUUID().slice(0, 8)}`,
    });
    await membersProbe.members.create({
      userId: member.id,
      projectId: project.id,
      owner: false,
    });
    return member.id;
  };

  return {
    alepha,
    repos,
    epicTools,
    questTools,
    folioTools,
    projectTools,
    project,
    call,
    OWNER,
    addNonOwnerMember,
  };
};

describe("Lore MCP — epics", () => {
  /**
   * The whole agent-facing loop, driven by somebody who does not own the
   * project: forge an epic, file a quest under it, file a folio under it.
   * Epic mutations were owner-only until 2026-08-28, so every one of these
   * calls answered 403 for a member — including through the web UI, whose
   * "Create epic" entry has always been shown to every member.
   */
  it("a non-owner member can create an epic and file work under it", async ({
    expect,
  }) => {
    const {
      repos,
      project,
      epicTools,
      questTools,
      folioTools,
      call,
      addNonOwnerMember,
    } = await setup();
    const memberId = await addNonOwnerMember();

    const epic = await call(
      epicTools.epic_create,
      { project: project.id, title: "Member's epic" },
      memberId,
    );

    const quest = await call(
      questTools.quest_create,
      {
        project: project.id,
        title: "Member's quest",
        description: "",
        area: "Deploy",
        priority: "medium",
        epic_number: epic.number,
      },
      memberId,
    );

    const folio = await call(
      folioTools.folio_create,
      {
        project: project.id,
        title: "Member's folio",
        epic_number: epic.number,
      },
      memberId,
    );

    expect((await repos.quests.getById(quest.id)).epicId).toBe(epic.id);
    expect((await repos.folios.getById(folio.id)).epicId).toBe(epic.id);
  });

  /**
   * ⚠️ This used to assert the opposite: that `quest_list` is never gated,
   * so an agent filing into a planned epic sees its quest on the next call.
   * That default made the tool disagree with the backlog a member looks at
   * (84 rows here against 5 in the UI on this project), with no parameter to
   * reconcile the two. Epic #31 flipped it: the default matches the UI, and
   * the two escape hatches below are what keep the original requirement.
   */
  it("quest_list hides a planned epic's quests by default, like the UI", async ({
    expect,
  }) => {
    const { alepha, project, questTools, call } = await setup();
    const epic = await createTestEpic(alepha, project, { status: "planned" });
    const parked = await createTestQuest(alepha, project, { epicId: epic.id });
    const loose = await createTestQuest(alepha, project);

    const result = await call(questTools.quest_list, { project: project.id });

    const listed = result.quests.map((q: any) => q.shortId);
    expect(listed).toContain(loose.shortId);
    expect(listed).not.toContain(parked.shortId);
  });

  it("quest_list shows them again with includePlanned: true", async ({
    expect,
  }) => {
    const { alepha, project, questTools, call } = await setup();
    const epic = await createTestEpic(alepha, project, { status: "planned" });
    const parked = await createTestQuest(alepha, project, { epicId: epic.id });

    const result = await call(questTools.quest_list, {
      project: project.id,
      includePlanned: true,
    });

    expect(result.quests.map((q: any) => q.shortId)).toContain(parked.shortId);
  });

  it("quest_list filtered on an epic is never gated, with no flag", async ({
    expect,
  }) => {
    // The case the old default existed for: an agent that just filed a quest
    // into a planned epic reads it back by addressing the epic.
    const { alepha, project, questTools, call } = await setup();
    const epic = await createTestEpic(alepha, project, { status: "planned" });
    const parked = await createTestQuest(alepha, project, { epicId: epic.id });

    const result = await call(questTools.quest_list, {
      project: project.id,
      epic: epic.id,
    });

    expect(result.quests.map((q: any) => q.shortId)).toContain(parked.shortId);
  });

  it("resolves epic_number to the global epic id, scoped to the project", async ({
    expect,
  }) => {
    const { alepha, repos, project, questTools, call } = await setup();
    const epic = await createTestEpic(alepha, project, { status: "planned" });

    const created = await call(questTools.quest_create, {
      project: project.id,
      title: "Artifact registry",
      description: "",
      area: "Deploy",
      priority: "medium",
      epic_number: epic.number,
    });

    expect((await repos.quests.getById(created.id)).epicId).toBe(epic.id);
  });

  describe("epic_list", () => {
    it("lists epics with status, questCount and the progress rollup", async ({
      expect,
    }) => {
      const { alepha, project, epicTools, call } = await setup();
      const epic = await createTestEpic(alepha, project, {
        title: "Lore Deploy",
        status: "planned",
      });
      await createTestQuest(alepha, project, { epicId: epic.id });

      const result = await call(epicTools.epic_list, { project: project.id });

      expect(result.epics).toHaveLength(1);
      expect(result.epics[0]).toMatchObject({
        number: epic.number,
        title: "Lore Deploy",
        status: "planned",
        questCount: 1,
        progress: { completed: 0, total: 1 },
      });
    });
  });

  describe("epic_get", () => {
    it("fetches a single epic by its per-project number", async ({
      expect,
    }) => {
      const { alepha, project, epicTools, call } = await setup();
      const epic = await createTestEpic(alepha, project, { title: "Deploy" });

      const result = await call(epicTools.epic_get, {
        project: project.id,
        number: epic.number,
      });

      expect(result.id).toBe(epic.id);
      expect(result.title).toBe("Deploy");
      expect(result.projectId).toBe(project.id);
    });

    it("throws NotFoundError for a number that does not exist in the project", async ({
      expect,
    }) => {
      const { project, epicTools, call } = await setup();

      await expect(
        call(epicTools.epic_get, { project: project.id, number: 999 }),
      ).rejects.toThrowError();
    });
  });

  describe("epic_create", () => {
    it("creates an epic in 'planned'", async ({ expect }) => {
      const { project, epicTools, call } = await setup();

      const created = await call(epicTools.epic_create, {
        project: project.id,
        title: "Lore Deploy",
      });

      expect(created.status).toBe("planned");
      expect(created.title).toBe("Lore Deploy");
      expect(created.number).toBe(1);
    });
  });

  describe("epic_update", () => {
    it("updates title and description", async ({ expect }) => {
      const { alepha, project, epicTools, call } = await setup();
      const epic = await createTestEpic(alepha, project, { title: "Old" });

      const updated = await call(epicTools.epic_update, {
        project: project.id,
        number: epic.number,
        title: "New title",
      });

      expect(updated.title).toBe("New title");
    });
  });

  describe("epic_set_status", () => {
    it("moves an epic through its lifecycle without touching its quests", async ({
      expect,
    }) => {
      const { alepha, repos, project, epicTools, call } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const quest = await createTestQuest(alepha, project, {
        epicId: epic.id,
      });
      const questUpdatedAtBefore = (await repos.quests.getById(quest.id))
        .updatedAt;

      const activated = await call(epicTools.epic_set_status, {
        project: project.id,
        number: epic.number,
        status: "active",
      });

      expect(activated.status).toBe("active");
      expect(activated.activatedAt).toBeDefined();
      expect((await repos.quests.getById(quest.id)).updatedAt).toEqual(
        questUpdatedAtBefore,
      );
    });
  });

  describe("epic_delete", () => {
    it("detaches the epic's quests and folios instead of deleting them", async ({
      expect,
    }) => {
      // The FK's `ON DELETE SET NULL` is the whole contract of this tool, and
      // the reason its description has to say so: an agent reading only the
      // tool list must not have to guess whether it is about to erase the
      // work filed under the epic.
      const { alepha, repos, project, epicTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });
      const folio = await createTestFolio(alepha, project, { epicId: epic.id });

      const result = await call(epicTools.epic_delete, {
        project: project.id,
        number: epic.number,
      });

      expect(result.ok).toBe(true);
      expect((await repos.quests.getById(quest.id)).epicId).toBeUndefined();
      expect((await repos.folios.getById(folio.id)).epicId).toBeUndefined();
    });

    it("removes the epic from epic_list, epic_get and project_context", async ({
      expect,
    }) => {
      // `epics` carries `deletedAt`, so a plain soft delete would leave the
      // row readable on all three surfaces while the caller believed it gone.
      // `deleteEpic` passes `force: true` for exactly that reason.
      const { alepha, project, epicTools, projectTools, call } = await setup();
      const doomed = await createTestEpic(alepha, project, { title: "Doomed" });
      const kept = await createTestEpic(alepha, project, { title: "Kept" });

      await call(epicTools.epic_delete, {
        project: project.id,
        number: doomed.number,
      });

      const list = await call(epicTools.epic_list, { project: project.id });
      expect(list.epics.map((e: any) => e.number)).toEqual([kept.number]);

      await expect(
        call(epicTools.epic_get, {
          project: project.id,
          number: doomed.number,
        }),
      ).rejects.toThrowError();

      const context = await call(projectTools.project_context, {
        project: project.id,
      });
      expect(context.epics.map((e: any) => e.title)).toEqual(["Kept"]);
    });

    it("refuses a caller who does not belong to the project", async ({
      expect,
    }) => {
      // Not a new behaviour: `resolveProjectId` filters through
      // `getMyProjects`, and `deleteEpic` carries its own `$ownsProject`.
      // Pinned anyway because this is the most destructive surface
      // `EpicTools` exposes, and both of those gates sit outside the tool.
      const { alepha, repos, project, epicTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const stranger = crypto.randomUUID();

      // `NotFoundError` and not `ForbiddenError`, asserted rather than left
      // to a bare `toThrowError()`: the refusal has to come from the
      // membership filter, and a bare assertion would also pass if the call
      // died on a broken fixture. The project is reported as not found
      // rather than forbidden, so the tool leaks no existence either.
      await expect(
        call(
          epicTools.epic_delete,
          { project: project.id, number: epic.number },
          stranger,
        ),
      ).rejects.toThrowError(NotFoundError);

      expect(await repos.epics.getById(epic.id)).toBeDefined();
    });
  });

  describe("project_context — epic index", () => {
    it("lists every epic with number, title, status and questCount", async ({
      expect,
    }) => {
      // Without this index a project with a planned epic's worth of quests
      // shows up as unrelated noise — no signal they're one parked subject.
      const { alepha, project, projectTools, call } = await setup();
      const epic = await createTestEpic(alepha, project, {
        title: "Lore Deploy",
        status: "planned",
      });
      await createTestQuest(alepha, project, { epicId: epic.id });
      await createTestQuest(alepha, project, { epicId: epic.id });

      const result = await call(projectTools.project_context, {
        project: project.id,
      });

      expect(result.epics).toEqual([
        {
          number: epic.number,
          title: "Lore Deploy",
          status: "planned",
          questCount: 2,
        },
      ]);
    });

    it("returns an empty array for a project with no epics", async ({
      expect,
    }) => {
      const { project, projectTools, call } = await setup();

      const result = await call(projectTools.project_context, {
        project: project.id,
      });

      expect(result.epics).toEqual([]);
    });
  });

  describe("quest_update — epic_number", () => {
    it("reparents a quest to a different epic", async ({ expect }) => {
      const { alepha, repos, project, questTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const quest = await createTestQuest(alepha, project);

      await call(questTools.quest_update, {
        id: quest.id,
        epic_number: epic.number,
      });

      expect((await repos.quests.getById(quest.id)).epicId).toBe(epic.id);
    });

    it("passing 0 clears the quest's epic link", async ({ expect }) => {
      const { alepha, repos, project, questTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const quest = await createTestQuest(alepha, project, {
        epicId: epic.id,
      });

      await call(questTools.quest_update, {
        id: quest.id,
        epic_number: 0,
      });

      expect((await repos.quests.getById(quest.id)).epicId).toBeUndefined();
    });
  });

  describe("epic_number failure does not leave a partial write", () => {
    /*
      `quest_create` / `quest_update` set `epicId` through a SECOND call to
      `EpicController`, because the quest actions have no such field. That
      second call can fail on its own, and these guard against the failure
      leaving a half-done side effect behind: a created-but-unattached quest
      an agent would duplicate on every retry, or a title written when the
      epic move it was paired with did not happen.

      The failure is injected (`failEpicAttach`) rather than borrowed from
      authorization — see `FailingAttachEpicController`. It used to come
      from the owner gate on `attachQuest`, which is membership now.
    */

    it("quest_create: a refused attach leaves no quest row behind", async ({
      expect,
    }) => {
      const { alepha, repos, project, questTools, call } = await setup({
        failEpicAttach: true,
      });
      const epic = await createTestEpic(alepha, project);
      const before = await repos.quests.count({
        projectId: { eq: project.id },
      });

      await expect(
        call(questTools.quest_create, {
          project: project.id,
          title: "Should not survive",
          description: "",
          area: "Deploy",
          priority: "medium",
          epic_number: epic.number,
        }),
      ).rejects.toThrowError();

      const after = await repos.quests.count({
        projectId: { eq: project.id },
      });
      expect(after).toBe(before);
    });

    it("quest_update: a refused attach leaves the other fields unchanged", async ({
      expect,
    }) => {
      const { alepha, repos, project, questTools, call } = await setup({
        failEpicAttach: true,
      });
      const epic = await createTestEpic(alepha, project);

      // No `epic_number` on the create — that call must succeed, so the
      // only thing the update below can be refused for is the epic move.
      // Without it the title would be unchanged for an unrelated reason
      // and the test would not distinguish the two.
      const created = await call(questTools.quest_create, {
        project: project.id,
        title: "Original title",
        description: "",
        area: "Deploy",
        priority: "medium",
      });

      await expect(
        call(questTools.quest_update, {
          id: created.id,
          title: "Changed title",
          epic_number: epic.number,
        }),
      ).rejects.toThrowError();

      expect((await repos.quests.getById(created.id)).title).toBe(
        "Original title",
      );
    });
  });

  describe("folio_create — epic_number", () => {
    it("attaches the new folio to the epic and returns the epic ref", async ({
      expect,
    }) => {
      // Before this, an agent had no way to file a folio under an epic: the
      // web picker could, `folio_create` could not, so every design folio an
      // agent wrote landed unattached and the epic's Folios tab read 0.
      const { alepha, repos, project, folioTools, call } = await setup();
      const epic = await createTestEpic(alepha, project, {
        title: "Lore Deploy",
        status: "planned",
      });

      const created = await call(folioTools.folio_create, {
        project: project.id,
        title: "Deploy design",
        content: "# Design",
        epic_number: epic.number,
      });

      expect((await repos.folios.getById(created.id)).epicId).toBe(epic.id);
      expect(created.epic).toEqual({
        number: epic.number,
        title: "Lore Deploy",
        status: "planned",
      });
    });

    it("a refused attach leaves no folio row behind", async ({ expect }) => {
      // Same cleanup contract as quest_create: no orphaned, unlinked folio
      // for an agent to duplicate on retry. Failure injected, see
      // `FailingAttachEpicController`.
      const { alepha, repos, project, folioTools, call } = await setup({
        failEpicAttach: true,
      });
      const epic = await createTestEpic(alepha, project);
      const before = await repos.folios.count({
        projectId: { eq: project.id },
      });

      await expect(
        call(folioTools.folio_create, {
          project: project.id,
          title: "Should not survive",
          epic_number: epic.number,
        }),
      ).rejects.toThrowError();

      const after = await repos.folios.count({
        projectId: { eq: project.id },
      });
      expect(after).toBe(before);
    });
  });

  describe("folio_update — epic_number", () => {
    it("reparents a folio to a different epic", async ({ expect }) => {
      const { alepha, repos, project, folioTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const folio = await createTestFolio(alepha, project);

      const updated = await call(folioTools.folio_update, {
        id: folio.id,
        epic_number: epic.number,
      });

      expect((await repos.folios.getById(folio.id)).epicId).toBe(epic.id);
      expect(updated.epic?.number).toBe(epic.number);
    });

    it("passing 0 clears the folio's epic link", async ({ expect }) => {
      const { alepha, repos, project, folioTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const folio = await createTestFolio(alepha, project, {
        epicId: epic.id,
      });

      const updated = await call(folioTools.folio_update, {
        id: folio.id,
        epic_number: 0,
      });

      expect((await repos.folios.getById(folio.id)).epicId).toBeUndefined();
      expect(updated.epic).toBeUndefined();
    });

    it("a refused attach leaves the other fields unchanged", async ({
      expect,
    }) => {
      // The epic move runs BEFORE the field update, so a failed attach
      // throws before `title` is written.
      const { alepha, repos, project, folioTools, call } = await setup({
        failEpicAttach: true,
      });
      const epic = await createTestEpic(alepha, project);
      const created = await call(folioTools.folio_create, {
        project: project.id,
        title: "Original title",
      });

      await expect(
        call(folioTools.folio_update, {
          id: created.id,
          title: "Changed title",
          epic_number: epic.number,
        }),
      ).rejects.toThrowError();

      expect((await repos.folios.getById(created.id)).title).toBe(
        "Original title",
      );
    });
  });

  describe("folio reads carry the epic", () => {
    it("folio_get returns the epic ref, and nothing for an unattached folio", async ({
      expect,
    }) => {
      const { alepha, project, folioTools, call } = await setup();
      const epic = await createTestEpic(alepha, project, { title: "Deploy" });
      const attached = await createTestFolio(alepha, project, {
        epicId: epic.id,
      });
      const loose = await createTestFolio(alepha, project);

      const a = await call(folioTools.folio_get, { id: attached.id });
      const b = await call(folioTools.folio_get, { id: loose.id });

      expect(a.epic).toEqual({
        number: epic.number,
        title: "Deploy",
        status: "planned",
      });
      expect(b.epic).toBeUndefined();
    });

    it("folio_list carries the epic ref and narrows on the `epic` filter", async ({
      expect,
    }) => {
      const { alepha, project, folioTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const other = await createTestEpic(alepha, project);
      const inEpic = await createTestFolio(alepha, project, {
        epicId: epic.id,
      });
      await createTestFolio(alepha, project, { epicId: other.id });
      await createTestFolio(alepha, project);

      const all = await call(folioTools.folio_list, { project: project.id });
      const filtered = await call(folioTools.folio_list, {
        project: project.id,
        epic: epic.id,
      });

      expect(all.folios).toHaveLength(3);
      expect(
        all.folios.find((f: any) => f.shortId === inEpic.shortId).epic.number,
      ).toBe(epic.number);
      expect(filtered.folios.map((f: any) => f.shortId)).toEqual([
        inEpic.shortId,
      ]);
    });

    it("epic_get lists the attached folios", async ({ expect }) => {
      // An epic "owns quests and folios"; quests were reachable through
      // quest_list's `epic` filter, folios through nothing at all.
      const { alepha, project, epicTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const folio = await createTestFolio(alepha, project, {
        epicId: epic.id,
        title: "Design",
        summary: "The design record",
      });
      await createTestFolio(alepha, project);

      const result = await call(epicTools.epic_get, {
        project: project.id,
        number: epic.number,
      });

      expect(result.folios).toEqual([
        {
          shortId: folio.shortId,
          title: "Design",
          summary: "The design record",
          updatedAt: folio.updatedAt,
        },
      ]);
    });

    it("project_context's folio index says which epic a folio belongs to", async ({
      expect,
    }) => {
      const { alepha, project, projectTools, call } = await setup();
      const epic = await createTestEpic(alepha, project);
      const attached = await createTestFolio(alepha, project, {
        epicId: epic.id,
      });
      const loose = await createTestFolio(alepha, project);

      const result = await call(projectTools.project_context, {
        project: project.id,
      });

      const byShortId = new Map(
        result.folios.items.map((f: any) => [f.shortId, f]),
      );
      expect((byShortId.get(attached.shortId) as any).epicNumber).toBe(
        epic.number,
      );
      expect((byShortId.get(loose.shortId) as any).epicNumber).toBeUndefined();
    });
  });
});

describe("Lore MCP - quest_list paging", () => {
  it("honours a raw offset instead of flooring it to a page", async ({
    expect,
  }) => {
    const { alepha, project, questTools, call } = await setup();

    // Titles carry their creation order, and the default sort is
    // `-updatedAt`, so the newest is first.
    for (let i = 0; i < 10; i++) {
      await createTestQuest(alepha, project, { title: `Q${i}` });
    }

    const all = await call(questTools.quest_list, {
      project: project.id,
      limit: 10,
    });
    expect(all.quests).toHaveLength(10);

    // `offset: 3, limit: 4` used to become `page: 0` (3 / 4 floored), so it
    // returned rows 0-3 while the tool doc promised 3-6.
    const window = await call(questTools.quest_list, {
      project: project.id,
      limit: 4,
      offset: 3,
    });

    expect(window.quests.map((q: any) => q.shortId)).toEqual(
      all.quests.slice(3, 7).map((q: any) => q.shortId),
    );
  });

  it("keeps a page-aligned offset working", async ({ expect }) => {
    const { alepha, project, questTools, call } = await setup();
    for (let i = 0; i < 6; i++) {
      await createTestQuest(alepha, project, { title: `Q${i}` });
    }

    const all = await call(questTools.quest_list, {
      project: project.id,
      limit: 6,
    });
    const second = await call(questTools.quest_list, {
      project: project.id,
      limit: 2,
      offset: 2,
    });

    expect(second.quests.map((q: any) => q.shortId)).toEqual(
      all.quests.slice(2, 4).map((q: any) => q.shortId),
    );
  });
});
