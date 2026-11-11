import { InvitationController, ProjectController } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { userDocks } from "../src/api/entities/userDocks.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { USER_DOCK_CAP } from "../src/api/schemas/userDockCap.ts";
import { UserDockService } from "../src/api/services/UserDockService.ts";
import {
  CoreTestEntities,
  createTestMember,
  createTestProject,
} from "../src/testing/index.ts";

class DockEntities extends CoreTestEntities {
  docks = $repository(userDocks);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

interface Person {
  id: string;
  roles: string[];
  email: string;
}

interface Ctx {
  alepha: Alepha;
  projects: ProjectController;
  invitations: InvitationController;
  dock: UserDockService;
  docks: DockEntities["docks"];
  person: () => Promise<Person>;
}

const setup = async (): Promise<Ctx> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreCoreApi);
  const repos = alepha.inject(DockEntities);
  await alepha.start();

  const admin = alepha.inject(AdminUserController);
  const fake = alepha.inject(FakeProvider);
  return {
    alepha,
    projects: alepha.inject(ProjectController),
    invitations: alepha.inject(InvitationController),
    dock: alepha.inject(UserDockService),
    docks: repos.docks,
    person: async () => {
      const data = fake.generate(
        z.object({ username: z.string(), email: z.email() }),
      );
      const res = await admin.createUser.fetch(
        { body: { ...data, roles: ["user"] } },
        { user: adminUser },
      );
      return { id: res.data.id, roles: res.data.roles, email: data.email };
    },
  };
};

/**
 * Joining a project puts it on the dock (#E139, #Q3435): creating one, or
 * accepting an invitation, the only two ways in. A full dock leaves the
 * project unpinned and says so.
 */
describe("the dock on create and join", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * Fill `user`'s dock with projects somebody else owns, so the creation
   * quota is untouched.
   */
  const fillDock = async (user: Person) => {
    const ids: number[] = [];
    for (let index = 0; index < USER_DOCK_CAP; index++) {
      const project = await createTestProject(ctx.alepha, {
        title: `Filler ${index}`,
      });
      await createTestMember(ctx.alepha, project, user.id);
      ids.push(project.id);
    }
    await ctx.dock.reorder(user.id, ids);
    return ids;
  };

  /**
   * The stored array, unfiltered: an unpin is a write, not the read filter.
   */
  const rowOf = async (userId: string) =>
    (await ctx.docks.findOne({ where: { userId: { eq: userId } } }))
      ?.projectIds;

  const invite = async (owner: Person, projectId: number, email: string) => {
    const res = await ctx.invitations.createInvitation.fetch(
      {
        body: { email, resourceType: "project", resourceId: String(projectId) },
      },
      { user: owner },
    );
    return res.data.id;
  };

  describe("create", () => {
    it("pins the new project at the end of the creator's dock", async ({
      expect,
    }) => {
      const me = await ctx.person();
      const first = await ctx.projects.createProject(
        { body: { title: "First one" } },
        { user: me },
      );
      const second = await ctx.projects.createProject(
        { body: { title: "Second one" } },
        { user: me },
      );

      expect(first.pinned).toBe(true);
      expect(second.pinned).toBe(true);
      expect(await ctx.dock.read(me.id)).toEqual([first.id, second.id]);
    });

    it("creates but does not pin when the dock is full", async ({ expect }) => {
      const me = await ctx.person();
      const filled = await fillDock(me);

      const created = await ctx.projects.createProject(
        { body: { title: "One too many" } },
        { user: me },
      );

      expect(created.pinned).toBe(false);
      expect(created.id).toBeGreaterThan(0);
      expect(await ctx.dock.read(me.id)).toEqual(filled);
    });
  });

  describe("accept", () => {
    it("pins the project for the user who accepted", async ({ expect }) => {
      const owner = await ctx.person();
      const project = await ctx.projects.createProject(
        { body: { title: "Shared one" } },
        { user: owner },
      );
      const invitee = await ctx.person();
      const id = await invite(owner, project.id, invitee.email);

      const result = await ctx.invitations.acceptInvitation.run(
        { params: { id } },
        { user: invitee },
      );

      expect(result.pinned).toBe(true);
      expect(await ctx.dock.read(invitee.id)).toEqual([project.id]);
    });

    it("joins but does not pin when the dock is full", async ({ expect }) => {
      const owner = await ctx.person();
      const project = await ctx.projects.createProject(
        { body: { title: "Shared one" } },
        { user: owner },
      );
      const invitee = await ctx.person();
      const filled = await fillDock(invitee);
      const id = await invite(owner, project.id, invitee.email);

      const result = await ctx.invitations.acceptInvitation.run(
        { params: { id } },
        { user: invitee },
      );

      expect(result.ok).toBe(true);
      expect(result.pinned).toBe(false);
      expect(await ctx.dock.read(invitee.id)).toEqual(filled);
    });
  });

  /**
   * Owner and invitee share a project the invitee pinned by accepting.
   */
  const shared = async () => {
    const owner = await ctx.person();
    const project = await ctx.projects.createProject(
      { body: { title: "Shared one" } },
      { user: owner },
    );
    await createPresetRanks(ctx.alepha, project.id);
    const invitee = await ctx.person();
    const id = await invite(owner, project.id, invitee.email);
    await ctx.invitations.acceptInvitation.run(
      { params: { id } },
      { user: invitee },
    );
    return { owner, invitee, project };
  };

  describe("unpin (#Q3436)", () => {
    it("unpins a project the user leaves", async ({ expect }) => {
      const { invitee, project } = await shared();
      expect(await rowOf(invitee.id)).toEqual([project.id]);
      await ctx.projects.leaveProject(
        { params: { id: project.id } },
        { user: invitee },
      );
      expect(await ctx.dock.read(invitee.id)).toEqual([]);
      expect(await rowOf(invitee.id)).toEqual([]);
    });

    it("unpins a project the user is removed from", async ({ expect }) => {
      const { owner, invitee, project } = await shared();
      await ctx.projects.removeMember(
        { params: { id: project.id, userId: invitee.id } },
        { user: owner },
      );
      expect(await rowOf(invitee.id)).toEqual([]);
    });

    it("unpins an archived project for every member, and unarchiving pins nothing back", async ({
      expect,
    }) => {
      const { owner, invitee, project } = await shared();
      await ctx.projects.archiveProject(
        { params: { id: project.id } },
        { user: owner },
      );
      expect(await rowOf(owner.id)).toEqual([]);
      expect(await rowOf(invitee.id)).toEqual([]);

      await ctx.projects.unarchiveProject(
        { params: { id: project.id } },
        { user: owner },
      );
      expect(await ctx.dock.read(owner.id)).toEqual([]);
      expect(await ctx.dock.read(invitee.id)).toEqual([]);
    });
  });
});
