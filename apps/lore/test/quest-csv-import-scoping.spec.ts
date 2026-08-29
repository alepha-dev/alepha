import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "@/api/controllers/ProjectController.ts";
import { ProjectQuestPortabilityController } from "@/api/controllers/ProjectQuestPortabilityController.ts";
import { QuestController } from "@/api/controllers/QuestController.ts";
import { LoreApi } from "@/api/index.ts";
import { AreaService } from "@/api/services/AreaService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const HEADER =
  "shortId,title,status,priority,size,area,kanbanColumn,milestone,createdBy,acceptedBy,completedBy,createdAt,acceptedAt,completedAt,objectives,description";

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  questController: QuestController;
  portController: ProjectQuestPortabilityController;
  areaService: AreaService;
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
    portController: alepha.inject(ProjectQuestPortabilityController),
    areaService: alepha.inject(AreaService),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; email: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return {
    id: response.data.id,
    email: fakeUser.email,
    roles: response.data.roles,
  };
};

const createTestProject = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
  title: string,
): Promise<{ id: number }> => {
  const response = await ctx.projectController.createProject.fetch(
    { body: { title } },
    { user },
  );
  return { id: response.data.id };
};

/**
 * Direct repo insert — the invitation round-trip is not what is under test.
 */
const addMember = async (
  ctx: TestContext,
  userId: string,
  projectId: number,
): Promise<void> => {
  await (ctx.projectController as any).members.create({
    userId,
    projectId,
    owner: false,
  });
};

const importCsv = (
  ctx: TestContext,
  projectId: number,
  csv: string,
  user: any,
) =>
  ctx.portController.importQuests.fetch(
    {
      params: { id: projectId },
      body: { file: new File([csv], "quests.csv", { type: "text/csv" }) },
    },
    { user },
  );

describe("quest CSV import: assignee scoping and input errors", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("assigns a member and refuses a stranger, without saying they exist", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    // A real account of this realm that is NOT in this project. Resolving
    // realm-wide would have found it, assigned the quest to someone who
    // cannot read it, and answered "this address has an account here".
    const stranger = await createTestUser(ctx);

    const project = await createTestProject(ctx, owner, "Scoped import");
    await addMember(ctx, member.id, project.id);

    const csv = [
      HEADER,
      `,Assigned to a member,accepted,medium,3,general,,,,${member.email},,,,,,`,
      `,Assigned to a stranger,accepted,medium,3,general,,,,${stranger.email},,,,,,`,
    ].join("\n");

    const result = (await importCsv(ctx, project.id, csv, owner)).data;

    expect(result.created).toBe(2);
    expect(result.errors).toEqual([]);

    const quests = (
      await ctx.questController.getQuests.fetch(
        { params: { projectId: project.id }, query: {} },
        { user: owner },
      )
    ).data.content;

    const assigned = quests.find((q) => q.title === "Assigned to a member");
    const unassigned = quests.find((q) => q.title === "Assigned to a stranger");

    expect(assigned?.acceptedBy).toBe(member.id);
    expect(unassigned?.acceptedBy).toBeFalsy();

    // Exactly one warning, and its wording must not double as a directory
    // lookup: "not a member of this project" is true whether or not the
    // address has an account.
    const strangerWarnings = result.warnings.filter((w) =>
      w.message.includes(stranger.email),
    );
    expect(strangerWarnings).toHaveLength(1);
    expect(strangerWarnings[0].message).toMatch(/not a member of this project/);
    expect(strangerWarnings[0].message).not.toMatch(/not found/i);

    expect(
      result.warnings.filter((w) => w.message.includes(member.email)),
    ).toEqual([]);
  });

  it("answers 400 for an empty CSV", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const project = await createTestProject(ctx, owner, "Empty import");

    try {
      await importCsv(ctx, project.id, "", owner);
      expect.unreachable("expected an empty CSV to be refused");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(400);
      expect((err as HttpError).error).toBe("BadRequestError");
    }
  });

  it("answers 400 for an unrecognized header", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const project = await createTestProject(ctx, owner, "Unknown import");

    try {
      await importCsv(ctx, project.id, "alpha,beta\n1,2", owner);
      expect.unreachable("expected an unknown header to be refused");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(400);
      expect((err as HttpError).error).toBe("BadRequestError");
    }
  });

  it("answers 400 when a merge names a source area that does not exist", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const project = await createTestProject(ctx, owner, "Merge input");
    const target = await ctx.areaService.ensureArea(project.id, "target");

    await expect(
      ctx.areaService.merge(project.id, [999_999], target!.id),
    ).rejects.toMatchObject({ name: "BadRequestError", status: 400 });
  });
});
