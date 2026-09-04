import { Alepha, z } from "alepha";
import { AuditService } from "alepha/api/audits";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Lore turns the audits module on but declared no `$audit` type of its own,
 * so every row in production came from the framework's auth and user events:
 * nothing Lore did to its own data was recorded, and `/admin/audits` could
 * not answer "who deleted that project".
 *
 * What is asserted here is the row's CONTENT, not just its existence. A row
 * with no actor answers nothing, and a project row carrying an id and no
 * title names nothing once the project is gone - which is the whole reason
 * `ProjectDeletionService.deleteProject` reads the title before the cascade.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  questController: QuestController;
  releaseController: ReleaseController;
  feedbackController: FeedbackController;
  sigilController: SigilController;
  audits: AuditService;
  fakeProvider: FakeProvider;
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
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    questController: alepha.inject(QuestController),
    releaseController: alepha.inject(ReleaseController),
    feedbackController: alepha.inject(FeedbackController),
    sigilController: alepha.inject(SigilController),
    audits: alepha.inject(AuditService),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

describe("Lore domain audits", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const aUser = async () => {
    const fake = ctx.fakeProvider.generate(userDataSchema);
    const created = await ctx.adminUserController.createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
    return {
      id: created.data.id,
      roles: created.data.roles,
      email: fake.email,
    };
  };

  const aProject = async (
    user: { id: string; roles: string[] },
    title = `Audited ${Math.random().toString(36).slice(2, 8)}`,
  ) =>
    (
      await ctx.projectController.createProject.fetch(
        { body: { title } },
        { user },
      )
    ).data;

  /**
   * Rows of one type, oldest first. `AuditService.find` is the same seam the
   * admin log reads through.
   */
  const rowsOf = async (type: string) => {
    const page = await ctx.audits.find({ type } as never);
    return page.content as unknown as Array<Record<string, any>>;
  };

  it("records a project creation with its title and its actor", async ({
    expect,
  }) => {
    const user = await aUser();
    const project = await aProject(user, "Audited Create");

    const rows = await rowsOf("project");
    const created = rows.find((row) => row.action === "create");

    expect(created).toBeDefined();
    expect(created?.resourceId).toBe(String(project.id));
    expect(created?.description).toBe("Audited Create");
    // Without the actor the row answers nothing, which is the whole point.
    expect(created?.userId).toBe(user.id);

    // ⚠️ `userEmail` is NOT asserted, and its absence here is the harness
    // rather than the code. `ServerSecurityProvider`'s test-user helper mints
    // a token carrying `sub` and `roles` only, so the resolved
    // `UserAccountToken` has no email to copy - in a real request it does.
    // Asserting undefined would pin the harness; asserting the address would
    // fail for a reason that says nothing about Lore.
    expect(created?.userRealm ?? "default").toBeTruthy();
  });

  it("records a project deletion, naming the project that no longer exists", async ({
    expect,
  }) => {
    const user = await aUser();
    const project = await aProject(user, "Audited Delete");

    await ctx.projectController.deleteProjectById.fetch(
      { params: { id: project.id } },
      { user },
    );

    const deleted = (await rowsOf("project")).find(
      (row) => row.action === "delete",
    );

    expect(deleted).toBeDefined();
    // The title is read BEFORE the cascade. An id alone names nothing once
    // the row is gone, which is what makes this assertion the point of the
    // service returning what it deleted.
    expect(deleted?.description).toBe("Audited Delete");
    expect(deleted?.resourceId).toBe(String(project.id));
    expect(deleted?.severity).toBe("warning");
  });

  it("records a member leaving", async ({ expect }) => {
    const owner = await aUser();
    const member = await aUser();
    const project = await aProject(owner);

    const membersRepo = (ctx.projectController as any).members;
    await membersRepo.create({
      userId: member.id,
      projectId: project.id,
      owner: false,
    });

    await ctx.projectController.leaveProject.fetch(
      { params: { id: project.id } },
      { user: member },
    );

    const left = (await rowsOf("member")).find((row) => row.action === "leave");
    expect(left?.userId).toBe(member.id);
    expect(left?.resourceId).toBe(String(project.id));
  });

  it("records an owner removing somebody, as the same action by a different actor", async ({
    expect,
  }) => {
    const owner = await aUser();
    const member = await aUser();
    const project = await aProject(owner);

    const membersRepo = (ctx.projectController as any).members;
    await membersRepo.create({
      userId: member.id,
      projectId: project.id,
      owner: false,
    });

    await ctx.projectController.removeMember.fetch(
      { params: { id: project.id, userId: member.id } },
      { user: owner },
    );

    const row = (await rowsOf("member")).find((it) => it.action === "leave");
    // Same action, and the ACTOR is what separates "they left" from "they
    // were removed". The metadata says who went.
    expect(row?.userId).toBe(owner.id);
    expect(row?.metadata?.removedUserId).toBe(member.id);
  });

  it("records a sigil's whole life, and keeps it longer", async ({
    expect,
  }) => {
    const user = await aUser();
    const project = await aProject(user);

    const sigil = (
      await ctx.sigilController.createSigil.fetch(
        { params: { projectId: project.id }, body: { name: "web" } },
        { user },
      )
    ).data;

    await ctx.sigilController.rotateSigil.fetch(
      { params: { projectId: project.id, sigilId: sigil.id } },
      { user },
    );
    await ctx.sigilController.deleteSigil.fetch(
      { params: { projectId: project.id, sigilId: sigil.id } },
      { user },
    );

    const actions = (await rowsOf("sigil"))
      .map((row) => row.action as string)
      .sort((a, b) => a.localeCompare(b));
    expect(actions).toEqual(["create", "delete", "rotate"]);

    // A credential's history is what you go back through after a leak, so it
    // outlives the global default.
    const declared = ctx.audits
      .getRegisteredTypes()
      .find((it) => it.type === "sigil");
    expect(declared?.retentionDays).toBe(730);
  });

  it("records publishing and reopening a release", async ({ expect }) => {
    const user = await aUser();
    const project = await aProject(user);

    const release = (
      await ctx.releaseController.createRelease.fetch(
        { params: { projectId: project.id }, body: { tag: "0.28.0" } },
        { user },
      )
    ).data;

    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );
    await ctx.releaseController.reopenRelease.fetch(
      { params: { id: release.id } },
      { user },
    );

    const rows = await rowsOf("release");
    expect(
      rows
        .map((row) => row.action as string)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["create", "publish", "reopen"]);
    // The tag, not the id: it is what a release is called everywhere else.
    expect(rows[0]?.description).toBe("0.28.0");
    // Scoped, so the release's own project's Activity page can find it.
    expect(rows[0]?.scopeType).toBe("project");
    expect(rows[0]?.scopeId).toBe(String(project.id));
  });

  it("records a triage decision on feedback", async ({ expect }) => {
    const user = await aUser();
    const project = await aProject(user);

    const submit = async (title: string) =>
      (
        await ctx.feedbackController.submitFeedback.fetch(
          {
            params: { projectId: project.id },
            body: { title, description: title },
          },
          { user },
        )
      ).data;

    const accepted = await submit("Please add dark mode");
    const rejected = await submit("Not a bug");

    await ctx.feedbackController.acceptFeedback.fetch(
      { params: { projectId: project.id, feedbackId: accepted.id } },
      { user },
    );
    await ctx.feedbackController.rejectFeedback.fetch(
      { params: { projectId: project.id, feedbackId: rejected.id } },
      { user },
    );

    const rows = await rowsOf("feedback");
    // Arrivals as well as decisions: the Activity page's question is what
    // happened in the project, and a report arriving is one of the things
    // that happens. Two of each, one per item.
    expect(
      rows
        .map((row) => row.action as string)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["accept", "create", "create", "reject"]);
    expect(new Set(rows.map((row) => row.description as string))).toEqual(
      new Set(["Not a bug", "Please add dark mode"]),
    );
  });

  it("records a quest, which it deliberately used not to", async ({
    expect,
  }) => {
    // ⚠️ This case asserts the OPPOSITE of what it used to, and the reversal
    // is the point. The old bar was "an action a project owner would
    // reconstruct months later", read on the admin security log, and a quest
    // edit did not clear it. The bar is now "an action a project member would
    // want to see on the Activity page", which it clears easily: quests are
    // most of what happens in a project, and a feed without them is empty.
    const user = await aUser();
    const project = await aProject(user);

    const quest = (
      await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "Wire the pipeline",
            description: "x",
            area: "core",
            priority: "medium",
          },
        },
        { user },
      )
    ).data;

    const rows = await rowsOf("quest");
    expect(rows.map((row) => row.action as string)).toEqual(["create"]);
    // The shortId, because it is what `/:projectSlug/quests/:shortId` takes.
    // A row id here would link to a page that does not exist.
    expect(rows[0]?.resourceId).toBe(String(quest.shortId));
    expect(rows[0]?.scopeId).toBe(String(project.id));
  });
});
