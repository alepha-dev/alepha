import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
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

describe("project slug lifecycle", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const create = async (
    user: { id: string; roles: string[] },
    title: string,
  ) => {
    const res = await ctx.projectController.createProject.fetch(
      { body: { title } },
      { user },
    );
    return res.data;
  };

  it("derives the slug from the title on create", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await create(user, "Hello World");
    expect(project.slug).toBe("hello-world");
  });

  it("rejects a title whose slug is already taken", async ({ expect }) => {
    const user = await createTestUser(ctx);
    await create(user, "Hello World");
    // Case and separator differences collapse to the same slug, so this is a
    // conflict even though the titles are not equal.
    await expect(create(user, "hello world")).rejects.toThrow(HttpError);
  });

  it("rejects a taken slug across owners, not just within one", async ({
    expect,
  }) => {
    // The slug is a root-level path segment, so uniqueness is instance-wide.
    const owner = await createTestUser(ctx);
    const other = await createTestUser(ctx);
    await create(owner, "Hello World");
    await expect(create(other, "Hello World")).rejects.toThrow(HttpError);
  });

  it("rejects a title whose slug is reserved", async ({ expect }) => {
    const user = await createTestUser(ctx);
    // `admin` would shadow a route the app already owns.
    await expect(create(user, "admin")).rejects.toThrow(HttpError);
  });

  it("falls back to the id namespace when nothing transliterates", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await create(user, "日本語");
    expect(project.slug).toBe(`project-${project.id}`);
  });

  it("recomputes the slug on rename", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await create(user, "Hello World");
    const renamed = await ctx.projectController.updateProjectById.fetch(
      { params: { id: project.id }, body: { title: "Elf - Summer" } },
      { user },
    );
    expect(renamed.data.slug).toBe("elf-summer");
  });

  it("does not treat a project's own slug as a conflict", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await create(user, "Hello World");
    const renamed = await ctx.projectController.updateProjectById.fetch(
      { params: { id: project.id }, body: { title: "Hello World" } },
      { user },
    );
    expect(renamed.data.slug).toBe("hello-world");
  });

  it("refuses a rename onto another project's slug", async ({ expect }) => {
    const user = await createTestUser(ctx);
    await create(user, "Hello World");
    const second = await create(user, "Elf Summer");
    await expect(
      ctx.projectController.updateProjectById.fetch(
        { params: { id: second.id }, body: { title: "Hello World" } },
        { user },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("frees the slug when the project is deleted", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await create(user, "Hello World");
    await ctx.projectController.deleteProjectById.fetch(
      { params: { id: project.id } },
      { user },
    );

    // The delete is a SOFT delete, so the row survives and keeps occupying the
    // unique index — while every read path filters it out. Without an explicit
    // clear, the availability check cannot see the slug but the index still
    // rejects it, and this reuse fails as a 500 rather than succeeding.
    const reused = await create(user, "Hello World");
    expect(reused.slug).toBe("hello-world");
  });

  it("resolves a project by its slug", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await create(user, "Hello World");
    const found = await ctx.projectController.getProjectBySlug.fetch(
      { params: { slug: "hello-world" } },
      { user },
    );
    expect(found.data.id).toBe(project.id);
    expect(found.data.title).toBe("Hello World");
  });

  it("404s on an unknown slug", async ({ expect }) => {
    const user = await createTestUser(ctx);
    await expect(
      ctx.projectController.getProjectBySlug.fetch(
        { params: { slug: "nope" } },
        { user },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("does not resolve a deleted project by its old slug", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await create(user, "Hello World");
    await ctx.projectController.deleteProjectById.fetch(
      { params: { id: project.id } },
      { user },
    );
    await expect(
      ctx.projectController.getProjectBySlug.fetch(
        { params: { slug: "hello-world" } },
        { user },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("refuses a non-member reading a project by slug", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    await create(owner, "Hello World");
    // A guessable URL must not become a read: the slug is the only thing that
    // changed, not the access model.
    await expect(
      ctx.projectController.getProjectBySlug.fetch(
        { params: { slug: "hello-world" } },
        { user: stranger },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("rejects a title outside the allowed charset", async ({ expect }) => {
    const user = await createTestUser(ctx);
    await expect(create(user, "Hello, World!")).rejects.toThrow();
  });

  it("still loads a project whose title predates the charset rule", async ({
    expect,
  }) => {
    // Grandfathering: the charset is enforced on write only. A row written
    // before `projectTitleSchema` existed must keep reading — tightening the
    // ENTITY schema instead would make it fail to decode, which is the
    // 2026-08-05 production incident.
    const user = await createTestUser(ctx);
    const project = await create(user, "Hello World");

    const repo = (ctx.projectController as any).projects;
    const row = await repo.findOne({ where: { id: { eq: project.id } } });
    row.title = "Hello, World!";
    await repo.save(row);

    const found = await ctx.projectController.getProjectBySlug.fetch(
      { params: { slug: "hello-world" } },
      { user },
    );
    expect(found.data.title).toBe("Hello, World!");
  });
});
