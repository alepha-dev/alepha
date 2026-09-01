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
import { LoreApi } from "../src/api/index.ts";

/**
 * `revokeProjectInvitation` — the owner's way to take back an invitation
 * that has been sent but not answered.
 *
 * `InvitationService.revoke` was already written and already correct; it was
 * reachable only through `AdminInvitationController`, so the person who sent
 * an invitation could not withdraw it. What is under test here is therefore
 * the gate and the route, not the state machine.
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
  invitationController: InvitationController;
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
    invitationController: alepha.inject(InvitationController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

/**
 * No `email` on the way out, unlike the invitee constructed by hand below:
 * `createUser` types it `string | undefined`, and nothing here needs it —
 * `assertOwner` reads `id`, and the one check that does read an email
 * (`assertOwnedByEmail`, on accept) is exercised against a literal.
 */
const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

describe("InvitationController.revokeProjectInvitation", () => {
  let ctx: TestContext;
  let owner: { id: string; roles: string[] };
  let projectId: number;
  let invitationId: string;

  beforeEach(async () => {
    ctx = await setup();
    owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Revoke test" } },
      { user: owner },
    );
    projectId = project.data.id;
    const invitation = await ctx.invitationController.createInvitation.fetch(
      {
        body: {
          email: "invited@example.com",
          resourceType: "project",
          resourceId: String(projectId),
        },
      },
      { user: owner },
    );
    invitationId = invitation.data.id;
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const pendingCount = async (): Promise<number> => {
    const res = await ctx.invitationController.listProjectInvitations.fetch(
      { params: { projectId } },
      { user: owner },
    );
    return res.data.length;
  };

  it("removes the invitation from the project's pending list", async ({
    expect,
  }) => {
    expect(await pendingCount()).toBe(1);

    await ctx.invitationController.revokeProjectInvitation.fetch(
      { params: { projectId, id: invitationId } },
      { user: owner },
    );

    expect(await pendingCount()).toBe(0);
  });

  it("kills the token rather than deleting the row", async ({ expect }) => {
    await ctx.invitationController.revokeProjectInvitation.fetch(
      { params: { projectId, id: invitationId } },
      { user: owner },
    );

    // Still there, now `revoked` — the audit trail `purgeResolved` clears on
    // its own schedule. It leaves the settings page because
    // `listProjectInvitations` asks for pending ones, not because anything
    // was destroyed.
    const invitation = await ctx.alepha
      .inject(InvitationService)
      .getById(invitationId);
    expect(invitation.status).toBe("revoked");

    // And the invited person can no longer act on it.
    const invitee = {
      id: crypto.randomUUID(),
      roles: ["user"],
      email: "invited@example.com",
    };
    await expect(
      ctx.invitationController.acceptInvitation.fetch(
        { params: { id: invitationId } },
        { user: invitee },
      ),
    ).rejects.toThrowError();
  });

  it("refuses a member who does not own the project", async ({ expect }) => {
    const stranger = await createTestUser(ctx);

    await expect(
      ctx.invitationController.revokeProjectInvitation.fetch(
        { params: { projectId, id: invitationId } },
        { user: stranger },
      ),
    ).rejects.toThrowError();

    expect(await pendingCount()).toBe(1);
  });

  it("refuses an invitation that belongs to another project", async ({
    expect,
  }) => {
    // The path names the project ownership is asserted against, so without
    // this check an owner of project A could revoke project B's invitations
    // by quoting their own project id.
    const other = await ctx.projectController.createProject.fetch(
      { body: { title: "Other project" } },
      { user: owner },
    );

    await expect(
      ctx.invitationController.revokeProjectInvitation.fetch(
        { params: { projectId: other.data.id, id: invitationId } },
        { user: owner },
      ),
    ).rejects.toThrowError();

    expect(await pendingCount()).toBe(1);
  });

  it("refuses to revoke the same invitation twice", async ({ expect }) => {
    await ctx.invitationController.revokeProjectInvitation.fetch(
      { params: { projectId, id: invitationId } },
      { user: owner },
    );

    await expect(
      ctx.invitationController.revokeProjectInvitation.fetch(
        { params: { projectId, id: invitationId } },
        { user: owner },
      ),
    ).rejects.toThrowError();
  });
});
