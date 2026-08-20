import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";
import {
  createTestEpic,
  createTestQuest,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { members } from "../../api/entities/members.ts";
import { LoreApi } from "../../api/index.ts";
import { LoreMcp } from "../index.ts";
import { EpicTools } from "./EpicTools.ts";
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
const setup = async () => {
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
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const repos = alepha.inject(TestEntityRepositories);
  const membersProbe = alepha.inject(MembersProbe);
  const epicTools = alepha.inject(EpicTools);
  const questTools = alepha.inject(QuestTools);
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
   * only needs `getMyProjects` to list this project for the member to reach
   * any tool at all; `EpicController`'s `assertOwner` is what then refuses
   * the epic mutation.
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
    projectTools,
    project,
    call,
    OWNER,
    addNonOwnerMember,
  };
};

describe("Lore MCP — epics", () => {
  it("quest_list is NOT gated — an agent still sees planned-epic quests", async ({
    expect,
  }) => {
    // Deliberate asymmetry with the UI. An agent that files a quest into a
    // planned epic must see it in its own next quest_list call, or the tool
    // looks as though it silently failed.
    const { alepha, project, questTools, call } = await setup();
    const epic = await createTestEpic(alepha, project, { status: "planned" });
    const quest = await createTestQuest(alepha, project, { epicId: epic.id });

    const result = await call(questTools.quest_list, { project: project.id });

    expect(result.quests.map((q: any) => q.shortId)).toContain(quest.shortId);
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

  describe("epic_number failure does not leave a partial write (non-owner member)", () => {
    /*
      `attachQuest`/`detachQuest` are owner-gated (`EpicController.assertOwner`),
      but `quest_create`/`quest_update` only need `quest:create`/`quest:update`
      — and `QuestController.deleteQuest`'s own check
      (`quest.createdBy !== user.id && project.createdBy !== user.id`) means the
      member who just created a quest is allowed to delete it too. So a member
      who is not the project owner can reach `quest_create`/`quest_update` with
      `epic_number` set, and the attach/detach is refused. These guard against
      that refusal leaving a half-done side effect behind.
    */

    it("quest_create: a refused attach leaves no quest row behind", async ({
      expect,
    }) => {
      const { alepha, repos, project, questTools, call, addNonOwnerMember } =
        await setup();
      const memberId = await addNonOwnerMember();
      const epic = await createTestEpic(alepha, project);
      const before = await repos.quests.count({
        projectId: { eq: project.id },
      });

      await expect(
        call(
          questTools.quest_create,
          {
            project: project.id,
            title: "Should not survive",
            description: "",
            area: "Deploy",
            priority: "medium",
            epic_number: epic.number,
          },
          memberId,
        ),
      ).rejects.toThrowError();

      const after = await repos.quests.count({
        projectId: { eq: project.id },
      });
      expect(after).toBe(before);
    });

    it("quest_update: a refused attach leaves the other fields unchanged", async ({
      expect,
    }) => {
      const { alepha, repos, project, questTools, call, addNonOwnerMember } =
        await setup();
      const memberId = await addNonOwnerMember();
      const epic = await createTestEpic(alepha, project);

      // The member creates their OWN quest (no epic_number here — this call
      // must succeed) so `updateQuestById`'s own creator check would ALSO
      // pass below. That is what makes the next assertion prove the
      // reorder: without it, `title` would already be refused for an
      // unrelated reason and the test would not distinguish the two.
      const created = await call(
        questTools.quest_create,
        {
          project: project.id,
          title: "Original title",
          description: "",
          area: "Deploy",
          priority: "medium",
        },
        memberId,
      );

      await expect(
        call(
          questTools.quest_update,
          {
            id: created.id,
            title: "Changed title",
            epic_number: epic.number,
          },
          memberId,
        ),
      ).rejects.toThrowError();

      expect((await repos.quests.getById(created.id)).title).toBe(
        "Original title",
      );
    });
  });
});
