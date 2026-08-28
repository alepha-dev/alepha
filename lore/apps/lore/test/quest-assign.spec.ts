import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

/**
 * `assignQuest` (quest #1213) is the other half of `acceptQuest`: work
 * moving BETWEEN people rather than being picked up. It is the first quest
 * mutation whose subject is somebody other than the caller, so the gate on
 * the target — not just on the caller — is what these specs are mostly for.
 */

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  projects: ProjectController;
  quests: QuestController;
  fake: FakeProvider;
  repos: TestEntityRepositories;
  dt: DateTimeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);
  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    fake: alepha.inject(FakeProvider),
    repos,
    dt: alepha.inject(DateTimeProvider),
  };
};

describe("assignQuest", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const makeUser = async () => {
    const created = await ctx.admin.createUser.fetch(
      { body: { ...ctx.fake.generate(userDataSchema), roles: ["user"] } },
      { user: adminUser },
    );
    return { id: created.data.id, roles: created.data.roles };
  };

  const setupProject = async () => {
    const owner = await makeUser();
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Assign probe" } },
      { user: owner },
    );
    const projectId = project.data.id;

    const quest = await ctx.quests.createQuest.fetch(
      {
        body: {
          title: "Hand me over",
          description: "<p>x</p>",
          area: "core",
          priority: "medium",
          projectId,
          objectives: [],
        },
      },
      { user: owner },
    );

    return { owner, projectId, quest: quest.data };
  };

  /**
   * A member joins by row; the owner is a member by virtue of creating the
   * project, which `isMemberById` honours the same way `isMember` does.
   */
  const addMember = async (projectId: number) => {
    const user = await makeUser();
    await ctx.repos.members.create({ projectId, userId: user.id });
    return user;
  };

  describe("handing work over", () => {
    it("assigns the quest to another member", async () => {
      const { owner, projectId, quest } = await setupProject();
      const other = await addMember(projectId);

      const res = await ctx.quests.assignQuest.fetch(
        { params: { id: quest.id }, body: { userId: other.id } },
        { user: owner },
      );

      expect(res.data.acceptedBy).toBe(other.id);
      expect(res.data.acceptedAt).toBeTruthy();
      expect(res.data.metadata.status).toBe("accepted");
    });

    it("records who received it, so the history is not just 'assigned'", async () => {
      const { owner, projectId, quest } = await setupProject();
      const other = await addMember(projectId);

      await ctx.quests.assignQuest.fetch(
        { params: { id: quest.id }, body: { userId: other.id } },
        { user: owner },
      );

      const stored = await ctx.repos.quests.getOne({
        where: { id: { eq: quest.id } },
      });
      const entry = stored.history.at(-1);
      expect(entry?.action).toBe("assigned");
      expect(entry?.by).toBe(owner.id);
      expect(entry?.targetUserId).toBe(other.id);
    });

    it("is a no-op when the quest is already theirs", async () => {
      const { owner, projectId, quest } = await setupProject();
      const other = await addMember(projectId);

      await ctx.quests.assignQuest.fetch(
        { params: { id: quest.id }, body: { userId: other.id } },
        { user: owner },
      );
      await ctx.quests.assignQuest.fetch(
        { params: { id: quest.id }, body: { userId: other.id } },
        { user: owner },
      );

      const stored = await ctx.repos.quests.getOne({
        where: { id: { eq: quest.id } },
      });
      const assignedRows = stored.history.filter(
        (h) => h.action === "assigned",
      );
      expect(assignedRows).toHaveLength(1);
    });
  });

  /**
   * The gate that makes this different from every other quest mutation:
   * the caller is authorized, and the ASSIGNEE is the one being checked.
   */
  describe("the membership gate on the target", () => {
    it("refuses a user who is not a member of the project", async () => {
      const { owner, quest } = await setupProject();
      const stranger = await makeUser();

      await expect(
        ctx.quests.assignQuest.fetch(
          { params: { id: quest.id }, body: { userId: stranger.id } },
          { user: owner },
        ),
      ).rejects.toThrowError();
    });

    it("leaves the quest untouched when it refuses", async () => {
      const { owner, quest } = await setupProject();
      const stranger = await makeUser();

      await ctx.quests.assignQuest
        .fetch(
          { params: { id: quest.id }, body: { userId: stranger.id } },
          { user: owner },
        )
        .catch(() => null);

      const stored = await ctx.repos.quests.getOne({
        where: { id: { eq: quest.id } },
      });
      expect(stored.acceptedBy).toBeFalsy();
    });
  });

  /**
   * Neither a running timer nor a reminder may travel with the quest —
   * silently inheriting either was the thing the quest called out.
   */
  describe("what does not travel with the quest", () => {
    it("stops a running timer, so the new assignee is not billed for the old one's work", async () => {
      const { owner, projectId, quest } = await setupProject();
      const other = await addMember(projectId);

      await ctx.repos.quests.updateById(quest.id, {
        acceptedBy: owner.id,
        acceptedAt: ctx.dt.nowISOString(),
        timerSessions: [{ startedAt: ctx.dt.nowISOString() }],
      });

      await ctx.quests.assignQuest.fetch(
        { params: { id: quest.id }, body: { userId: other.id } },
        { user: owner },
      );

      const stored = await ctx.repos.quests.getOne({
        where: { id: { eq: quest.id } },
      });
      expect(stored.timerSessions.at(-1)?.stoppedAt).toBeTruthy();
    });

    it("clears the reminder, so nobody is emailed about work that is no longer theirs", async () => {
      const { owner, projectId, quest } = await setupProject();
      const other = await addMember(projectId);

      await ctx.repos.quests.updateById(quest.id, {
        acceptedBy: owner.id,
        acceptedAt: ctx.dt.nowISOString(),
        reminderInterval: "daily",
        reminderNextAt: ctx.dt.nowISOString(),
      });

      await ctx.quests.assignQuest.fetch(
        { params: { id: quest.id }, body: { userId: other.id } },
        { user: owner },
      );

      const stored = await ctx.repos.quests.getOne({
        where: { id: { eq: quest.id } },
      });
      expect(stored.reminderInterval).toBeFalsy();
      expect(stored.reminderNextAt).toBeFalsy();
    });
  });
});
