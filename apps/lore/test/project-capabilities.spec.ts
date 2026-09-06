import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectCapabilityController } from "../src/api/controllers/ProjectCapabilityController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  capabilityController: ProjectCapabilityController;
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
    capabilityController: alepha.inject(ProjectCapabilityController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

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

describe("Project capabilities", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("starts a project with exactly the capabilities it was given", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      {
        body: {
          title: "Test Project",
          capabilities: [
            { key: "work", options: { board: true } },
            { key: "knowledge" },
          ],
        },
      },
      { user },
    );

    expect(created.data.capabilities.map((it) => it.key).sort()).toEqual([
      "knowledge",
      "work",
    ]);
    // Options come back complete, defaults filled in, so no client ever has
    // to decide what an absent key means.
    expect(
      created.data.capabilities.find((it) => it.key === "work")?.options,
    ).toStrictEqual({
      board: true,
      epics: false,
      releases: false,
      estimate: false,
      chrono: false,
      reminder: false,
    });
  });

  it("creates a project with no capability at all", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Bare Project" } },
      { user },
    );

    // The modularity test. A project with nothing turned on is a legal state,
    // not an error, and every core read still answers for it.
    expect(created.data.capabilities).toEqual([]);

    const fetched = await ctx.projectController.getProjectById.fetch(
      { params: { id: created.data.id } },
      { user },
    );
    expect(fetched.data.capabilities).toEqual([]);
    expect(fetched.data.title).toBe("Bare Project");
  });

  it("refuses an option key it does not know", async ({ expect }) => {
    const user = await createTestUser(ctx);

    // `features` was `.partial()`, so a typo has been accepted and silently
    // dropped for as long as this endpoint has existed. Closing that is most
    // of the point of a closed enum on the way in.
    await expect(
      ctx.projectController.createProject.fetch(
        {
          body: {
            title: "Typo Project",
            capabilities: [{ key: "apps", options: { trakc: true } }],
          },
        },
        { user },
      ),
    ).rejects.toThrowError();
  });

  it("turns one on, and answers the whole project back", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Toggle Project", capabilities: [{ key: "work" }] } },
      { user },
    );

    const updated = await ctx.capabilityController.setCapability.fetch(
      {
        params: { projectId: created.data.id, key: "support" },
        body: { enabled: true },
      },
      { user },
    );

    // The full resource, so one round-trip refreshes both project atoms.
    expect(updated.data.title).toBe("Toggle Project");
    expect(updated.data.capabilities.map((it) => it.key).sort()).toEqual([
      "support",
      "work",
    ]);
  });

  it("deletes the row when a capability is turned off", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      {
        body: {
          title: "Off Project",
          capabilities: [{ key: "work" }, { key: "knowledge" }],
        },
      },
      { user },
    );

    const updated = await ctx.capabilityController.setCapability.fetch(
      {
        params: { projectId: created.data.id, key: "knowledge" },
        body: { enabled: false },
      },
      { user },
    );

    // Absence IS disabled. There is no `enabled: false` row for a reader to
    // get the wrong way round.
    expect(updated.data.capabilities.map((it) => it.key)).toEqual(["work"]);
  });

  it("turns the last one off, and the project still reads", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Empty Project", capabilities: [{ key: "work" }] } },
      { user },
    );

    // No floor in Settings, deliberately: the owner asked for everything-off
    // to work, as the proof that the modularity is real. The wizard keeps its
    // at-least-one rule, because a wizard is asking a question.
    const updated = await ctx.capabilityController.setCapability.fetch(
      {
        params: { projectId: created.data.id, key: "work" },
        body: { enabled: false },
      },
      { user },
    );
    expect(updated.data.capabilities).toEqual([]);

    const fetched = await ctx.projectController.getProjectBySlug.fetch(
      { params: { slug: updated.data.slug } },
      { user },
    );
    expect(fetched.data.capabilities).toEqual([]);
  });

  it("replaces options rather than merging them", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      {
        body: {
          title: "Options Project",
          capabilities: [
            { key: "work", options: { board: true, epics: true } },
          ],
        },
      },
      { user },
    );

    const updated = await ctx.capabilityController.setCapability.fetch(
      {
        params: { projectId: created.data.id, key: "work" },
        body: { enabled: true, options: { board: true } },
      },
      { user },
    );

    // Sent whole, the rule `kanbanColumnConfig` and `tagColors` already
    // follow: omitting a key is how it is cleared, and a merge cannot say so.
    const work = updated.data.capabilities.find((it) => it.key === "work");
    expect(work?.options.board).toBe(true);
    expect(work?.options.epics).toBe(false);
  });

  it("persists a capability across a later read", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Persisted", capabilities: [{ key: "apps" }] } },
      { user },
    );

    await ctx.capabilityController.setCapability.fetch(
      {
        params: { projectId: created.data.id, key: "apps" },
        body: { enabled: true, options: { track: true } },
      },
      { user },
    );

    // Through `getProjectBySlug`, which is the read the whole web app boots
    // from and the one served from a 30s cache.
    const fetched = await ctx.projectController.getProjectBySlug.fetch(
      { params: { slug: created.data.slug } },
      { user },
    );
    const apps = fetched.data.capabilities.find((it) => it.key === "apps");
    expect(apps?.options).toStrictEqual({ track: true, deploy: false });
  });

  it("refuses a capability write from someone who is not the owner", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Guarded", capabilities: [{ key: "work" }] } },
      { user: owner },
    );

    await expect(
      ctx.capabilityController.setCapability.fetch(
        {
          params: { projectId: created.data.id, key: "support" },
          body: { enabled: true },
        },
        { user: stranger },
      ),
    ).rejects.toThrowError();
  });
});
