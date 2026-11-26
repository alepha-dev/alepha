import {
  AdminProjectController,
  ProjectController,
  ProjectSecurityService,
} from "@lore/core/api";
import { QuestController } from "@lore/plan/api";
import { FolioController } from "@lore/remember/api";
import { Alepha, z } from "alepha";
import { MemberController } from "alepha/api/organizations";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * An instance admin inside a project (#Q4538): refused like any non-member,
 * let in by joining from /admin, which the project's activity records, and
 * refused again once they left. The system user keeps its way in.
 */
const bootstrapAdmin = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

describe("instance admin and project membership", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    bootLore(alepha);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const account = async (roles: string[]) => {
    const fake = alepha.inject(FakeProvider);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake.generate(userDataSchema), roles } },
        { user: bootstrapAdmin },
      );
    return { id: created.data.id, roles: created.data.roles };
  };

  const world = async () => {
    const owner = await account(["user"]);
    const admin = await account(["admin"]);
    const stranger = await account(["user"]);
    const project = await alepha.inject(ProjectController).createProject.fetch(
      {
        body: {
          title: "Private",
          capabilities: [{ key: "plan" }, { key: "remember" }],
        },
      },
      { user: owner },
    );
    const projectId = project.data.id;
    const quest = await alepha.inject(QuestController).createQuest.fetch(
      {
        body: {
          projectId,
          title: "Secret quest",
          area: "core",
          priority: "medium",
        },
      },
      { user: owner },
    );
    const folio = await alepha
      .inject(FolioController)
      .create.fetch(
        { body: { projectId, title: "Secret folio", content: "Inside." } },
        { user: owner },
      );
    return {
      owner,
      admin,
      stranger,
      projectId,
      questId: quest.data.id,
      folioId: folio.data.id,
    };
  };

  /**
   * The three reads, each answering the HTTP status it refused with, or 200.
   */
  const reads = async (
    w: Awaited<ReturnType<typeof world>>,
    user: { id: string; roles: string[] },
  ) => {
    const status = (call: Promise<unknown>) =>
      call.then(
        () => 200,
        (error: unknown) => (error as { status?: number }).status ?? 500,
      );
    return [
      await status(
        alepha
          .inject(ProjectController)
          .getProjectById.fetch({ params: { id: w.projectId } }, { user }),
      ),
      await status(
        alepha
          .inject(QuestController)
          .getQuestById.fetch({ params: { id: w.questId } }, { user }),
      ),
      await status(
        alepha
          .inject(FolioController)
          .get.fetch({ params: { id: w.folioId } }, { user }),
      ),
    ];
  };

  it("refuses an admin who is not a member like any stranger", async () => {
    const w = await world();

    const strangerSees = await reads(w, w.stranger);
    expect(strangerSees.every((it) => it !== 200)).toBe(true);
    expect(await reads(w, w.admin)).toEqual(strangerSees);
  });

  it("lets the admin in after Join, and out again after leaving", async () => {
    const w = await world();

    const joined = await alepha
      .inject(AdminProjectController)
      .adminJoinProject.fetch(
        { params: { id: w.projectId } },
        { user: w.admin },
      );
    // The project has an owner, so the admin takes the admin rank.
    expect(joined.data.rank).toBe("admin");
    expect(await reads(w, w.admin)).toEqual([200, 200, 200]);

    await alepha
      .inject(ProjectController)
      .leaveProject.fetch({ params: { id: w.projectId } }, { user: w.admin });
    expect((await reads(w, w.admin)).every((it) => it !== 200)).toBe(true);
  });

  it("records the join and the leave in the project's activity", async () => {
    const w = await world();
    const admins = alepha.inject(AdminProjectController);
    await admins.adminJoinProject.fetch(
      { params: { id: w.projectId } },
      { user: w.admin },
    );
    await alepha
      .inject(ProjectController)
      .leaveProject.fetch({ params: { id: w.projectId } }, { user: w.admin });

    const activity = await alepha
      .inject(ProjectController)
      .getProjectActivity.fetch(
        { params: { id: w.projectId }, query: { type: "member" } },
        { user: w.owner },
      );
    const rows = activity.data.content.filter(
      (row) => row.userId === w.admin.id,
    );
    expect(rows.map((row) => row.action).sort()).toEqual(["join", "leave"]);
    const join = rows.find((row) => row.action === "join");
    expect(join?.metadata).toMatchObject({
      instanceAdmin: true,
      rank: "admin",
      rankName: "Admin",
    });
  });

  it("refuses the framework's member routes to an admin who is not a member", async () => {
    const w = await world();
    const organizationId = await alepha
      .inject(ProjectSecurityService)
      .organizationIdOf(w.projectId);
    const members = alepha.inject(MemberController);

    await expect(
      members.getOrganizationMembers.fetch(
        { params: { organizationId } },
        { user: w.admin },
      ),
    ).rejects.toThrow();
    await expect(
      members.getOrganizationMembers.fetch(
        { params: { organizationId } },
        { user: w.owner },
      ),
    ).resolves.toBeDefined();
  });

  it("lists Join only for a project the admin is not a member of", async () => {
    const w = await world();
    const admins = alepha.inject(AdminProjectController);
    const row = async () =>
      (
        await admins.findProjects.fetch({ query: {} }, { user: w.admin })
      ).data.content.find((it) => it.id === w.projectId);

    expect((await row())?.joined).toBe(false);
    await admins.adminJoinProject.fetch(
      { params: { id: w.projectId } },
      { user: w.admin },
    );
    expect((await row())?.joined).toBe(true);
  });

  it("refuses a second Join while the admin is a member", async () => {
    const w = await world();
    const admins = alepha.inject(AdminProjectController);
    await admins.adminJoinProject.fetch(
      { params: { id: w.projectId } },
      { user: w.admin },
    );
    await expect(
      admins.adminJoinProject.fetch(
        { params: { id: w.projectId } },
        { user: w.admin },
      ),
    ).rejects.toThrow();
  });

  it("still archives a project from /admin without membership", async () => {
    const w = await world();
    const admins = alepha.inject(AdminProjectController);

    await admins.adminSetProjectArchived.fetch(
      { params: { id: w.projectId }, body: { archived: true } },
      { user: w.admin },
    );
    await admins.adminSetProjectArchived.fetch(
      { params: { id: w.projectId }, body: { archived: false } },
      { user: w.admin },
    );
    await admins.deleteProject.fetch(
      { params: { id: w.projectId } },
      { user: w.admin },
    );
    const listed = await admins.findProjects.fetch(
      { query: {} },
      { user: w.admin },
    );
    expect(listed.data.content.some((it) => it.id === w.projectId)).toBe(false);
  });

  it("keeps the system user's access to a project it is not a member of", async () => {
    const w = await world();
    // An identity BUILT unrestricted, the way a job's system user is, for an
    // account that is no member of the project.
    const system = {
      id: (await account(["user"])).id,
      roles: ["admin"],
      ownership: false,
    };

    const quest = await alepha
      .inject(QuestController)
      .getQuestById.run({ params: { id: w.questId } }, { user: system });
    expect(quest.title).toBe("Secret quest");

    const created = await alepha.inject(QuestController).createQuest.run(
      {
        body: {
          projectId: w.projectId,
          title: "Filed by a job",
          area: "core",
          priority: "medium",
        },
      },
      { user: system },
    );
    expect(created.title).toBe("Filed by a job");
  });
});
