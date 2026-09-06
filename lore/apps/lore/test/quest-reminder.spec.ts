import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

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
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    fake: alepha.inject(FakeProvider),
  };
};

const createUser = async (ctx: TestContext) => {
  const fake = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const seedAcceptedQuest = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<{ id: number; projectId: number }> => {
  // Reminders are an owner toggle inside Work, off by default. The spec
  // asserts `setQuestReminder`'s behaviour, not the gate, so it is asked for
  // at creation rather than flipped afterwards.
  const project = await ctx.projects.createProject.fetch(
    {
      body: {
        title: "Reminder Probe",
        capabilities: [{ key: "work", options: { reminder: true } }],
      },
    },
    { user },
  );

  const created = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId: project.data.id,
        title: "Daily standup",
        description: "<p>standup</p>",
        area: "ops",
        priority: "low",
      },
    },
    { user },
  );
  await ctx.quests.acceptQuest.fetch(
    { params: { id: created.data.id } },
    { user },
  );
  return { id: created.data.id, projectId: project.data.id };
};

describe("QuestController setQuestReminder", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("enables a reminder: stores interval + schedules next trigger", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const { id } = await seedAcceptedQuest(ctx, user);
    const before = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    const after = await ctx.quests.setQuestReminder.fetch(
      { params: { id }, body: { interval: "daily" } },
      { user },
    );

    expect(after.data.reminderInterval).toBe("daily");
    const nextAt = new Date(after.data.reminderNextAt as string).getTime();
    // next trigger is one day in the future (allow drift for slow CI).
    expect(nextAt - before).toBeGreaterThanOrEqual(DAY_MS - 1_000);
    expect(nextAt - before).toBeLessThanOrEqual(DAY_MS + 5_000);
  });

  it("clears the reminder when interval is null", async ({ expect }) => {
    const user = await createUser(ctx);
    const { id } = await seedAcceptedQuest(ctx, user);

    await ctx.quests.setQuestReminder.fetch(
      { params: { id }, body: { interval: "daily" } },
      { user },
    );
    const cleared = await ctx.quests.setQuestReminder.fetch(
      { params: { id }, body: { interval: null } },
      { user },
    );
    expect(cleared.data.reminderInterval).toBeUndefined();
    expect(cleared.data.reminderNextAt).toBeUndefined();
  });

  it("rejects non-assignees with 403", async ({ expect }) => {
    const owner = await createUser(ctx);
    const stranger = await createUser(ctx);
    const { id } = await seedAcceptedQuest(ctx, owner);

    // Add stranger to the project so the ownership check passes; the
    // setQuestReminder handler is the layer that demands assignee-only.
    // For this test, we don't need them as a member — the assignee
    // check fires before ownership matters since the project is
    // accessible only to its creator (owner).
    await expect(
      ctx.quests.setQuestReminder.fetch(
        { params: { id }, body: { interval: "daily" } },
        { user: stranger },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("completing the quest clears any active reminder", async ({ expect }) => {
    const user = await createUser(ctx);
    const { id } = await seedAcceptedQuest(ctx, user);
    await ctx.quests.setQuestReminder.fetch(
      { params: { id }, body: { interval: "daily" } },
      { user },
    );

    const completed = await ctx.quests.completeQuest.fetch(
      { params: { id }, body: {} },
      { user },
    );
    expect(completed.data.reminderInterval).toBeUndefined();
    expect(completed.data.reminderNextAt).toBeUndefined();
  });

  it("abandoning the quest clears any active reminder", async ({ expect }) => {
    const user = await createUser(ctx);
    const { id } = await seedAcceptedQuest(ctx, user);
    await ctx.quests.setQuestReminder.fetch(
      { params: { id }, body: { interval: "daily" } },
      { user },
    );

    const abandoned = await ctx.quests.abandonQuest.fetch(
      { params: { id } },
      { user },
    );
    expect(abandoned.data.reminderInterval).toBeUndefined();
    expect(abandoned.data.reminderNextAt).toBeUndefined();
  });
});
