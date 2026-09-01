import { Alepha, z } from "alepha";
import { InvitationService } from "alepha/api/invitations";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { InvitationController } from "../src/api/controllers/InvitationController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ProjectLimits } from "../src/api/services/ProjectLimits.ts";

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
  invitationController: InvitationController;
  invitationService: InvitationService;
  limits: ProjectLimits;
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
    invitationController: alepha.inject(InvitationController),
    invitationService: alepha.inject(InvitationService),
    limits: alepha.inject(ProjectLimits),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[]; email: string }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return {
    id: response.data.id,
    roles: response.data.roles,
    email: fakeUser.email,
  };
};

/**
 * `ProjectLimits` declared four caps and only one of them - projects per
 * user - was ever read. The other three were parameters an admin could set
 * from `/admin/parameters` and watch do nothing.
 *
 * Each case tightens the cap through the parameter rather than creating
 * hundreds of rows, which is also the half worth pinning: the point of
 * `$parameter` is that a change goes live without a redeploy.
 */
describe("ProjectLimits enforcement", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const tighten = async (patch: {
    maxMembersPerProject?: number;
    maxQuestsPerProject?: number;
    maxReleasesPerProject?: number;
  }) => {
    await ctx.limits.limits.set({
      maxProjectsPerUser: 10,
      maxMembersPerProject: 100,
      maxQuestsPerProject: 5_000,
      maxReleasesPerProject: 200,
      ...patch,
    });
  };

  const project = async (owner: { id: string; roles: string[] }) => {
    const response = await ctx.projectController.createProject.fetch(
      { body: { title: `Limits ${crypto.randomUUID().slice(0, 8)}` } },
      { user: owner },
    );
    return response.data;
  };

  const createQuest = (
    owner: { id: string; roles: string[] },
    projectId: number,
    title: string,
  ) =>
    ctx.questController.createQuest.fetch(
      {
        body: {
          projectId,
          title,
          description: "",
          area: "",
          priority: "medium",
        },
      },
      { user: owner },
    );

  it("refuses the quest past maxQuestsPerProject", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    await tighten({ maxQuestsPerProject: 2 });

    await createQuest(owner, p.id, "One");
    await createQuest(owner, p.id, "Two");
    await expect(createQuest(owner, p.id, "Three")).rejects.toThrowError(
      /maximum number of quests allowed \(2\)/,
    );

    // The refused create must not have burned a shortId either: the next
    // quest, once there is room again, takes the number the third would have.
    await tighten({ maxQuestsPerProject: 5_000 });
    const third = await createQuest(owner, p.id, "Three, later");
    expect(third.data.shortId).toBe(3);
  });

  it("counts quests per project, not across the instance", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const a = await project(owner);
    const b = await project(owner);
    await tighten({ maxQuestsPerProject: 1 });

    await createQuest(owner, a.id, "In A");
    await expect(createQuest(owner, a.id, "Also in A")).rejects.toThrowError(
      /maximum number of quests/,
    );
    // B is untouched by A's fullness.
    const inB = await createQuest(owner, b.id, "In B");
    expect(inB.data.title).toBe("In B");
  });

  it("refuses the release past maxReleasesPerProject", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    await tighten({ maxReleasesPerProject: 1 });

    // Left OPEN on purpose. There is no "one at a time" rule any more, so
    // the cap is the only thing that can refuse the second one - which is
    // exactly what makes it worth a test.
    await ctx.releaseController.createRelease.fetch(
      { params: { projectId: p.id }, body: { tag: "0.1.0" } },
      { user: owner },
    );

    await expect(
      ctx.releaseController.createRelease.fetch(
        { params: { projectId: p.id }, body: { tag: "0.2.0" } },
        { user: owner },
      ),
    ).rejects.toThrowError(/maximum number of releases allowed \(1\)/);
  });

  it("refuses an invitation once the project is full", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    // The owner is already a member, so a cap of 1 leaves no room.
    await tighten({ maxMembersPerProject: 1 });

    const guest = await createTestUser(ctx);
    await expect(
      ctx.invitationService.create(
        {
          email: guest.email,
          resourceType: "project",
          resourceId: String(p.id),
        },
        { ...owner, email: `${owner.id}@example.com` },
      ),
    ).rejects.toThrowError(/maximum number of members allowed \(1\)/);
  });

  it("refuses the accept that would overflow, even when the invite predates the cap", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    const guest = await createTestUser(ctx);

    // Invited while there is room...
    const invitation = await ctx.invitationService.create(
      {
        email: guest.email,
        resourceType: "project",
        resourceId: String(p.id),
      },
      { ...owner, email: `${owner.id}@example.com` },
    );

    // ...and the seat is gone by the time it is accepted. Pending
    // invitations are capped separately, so the invite-time check cannot
    // stand in for this one.
    await tighten({ maxMembersPerProject: 1 });

    await expect(
      ctx.invitationService.accept(invitation.id, guest),
    ).rejects.toThrowError(/maximum number of members allowed \(1\)/);
  });

  it("still accepts an invitation when there is room", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const p = await project(owner);
    const guest = await createTestUser(ctx);
    await tighten({ maxMembersPerProject: 2 });

    const invitation = await ctx.invitationService.create(
      {
        email: guest.email,
        resourceType: "project",
        resourceId: String(p.id),
      },
      { ...owner, email: `${owner.id}@example.com` },
    );
    const accepted = await ctx.invitationService.accept(invitation.id, guest);
    // `accept` names the resource generically now: the module does not know
    // a project from a booking, and Lore's controller is what maps
    // `resourceId` back onto `projectId` for the HTTP response.
    expect(accepted).toEqual({
      resourceType: "project",
      resourceId: String(p.id),
    });
  });
});
