import { $inject, Alepha, z } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm, $repository } from "alepha/orm";
import {
  AlephaSecurity,
  OwnedResourceProvider,
  type UserAccountToken,
} from "alepha/security";
import { AlephaServer, ForbiddenError, $action } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { epics } from "../src/api/entities/epics.ts";
import type { Project } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import { $ownsProject } from "../src/api/security/$ownsProject.ts";
import {
  createTestEpic,
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * A controller that exists only to exercise the four shapes `$ownsProject`
 * has to cover, without dragging in whatever else a real controller does.
 *
 * Every handler returns the project title read back off the gate, so a test
 * that passes has proved both halves at once: the caller was allowed, and the
 * authority row reached the handler without a second query.
 */
class GateTestController {
  epics = $repository(epics);
  owned = $inject(OwnedResourceProvider);

  readProject = $action({
    method: "GET",
    path: "/gate-test/projects/:projectId",
    use: [$ownsProject({ param: "projectId" })],
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.text(),
    },
    handler: async () => this.owned.authority<Project>().title,
  });

  readProjectAsOwner = $action({
    method: "GET",
    path: "/gate-test/projects/:projectId/owner",
    use: [$ownsProject({ param: "projectId", owner: true })],
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.text(),
    },
    handler: async () => this.owned.authority<Project>().title,
  });

  readEpic = $action({
    method: "GET",
    path: "/gate-test/epics/:id",
    use: [$ownsProject({ repository: () => this.epics, param: "id" })],
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.text(),
    },
    handler: async () =>
      `${this.owned.get<{ title: string }>().title} in ${this.owned.authority<Project>().title}`,
  });

  readEpicAsOwner = $action({
    method: "GET",
    path: "/gate-test/epics/:id/owner",
    use: [
      $ownsProject({
        repository: () => this.epics,
        param: "id",
        owner: true,
      }),
    ],
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.text(),
    },
    handler: async () => this.owned.authority<Project>().title,
  });

  searchByQuery = $action({
    method: "GET",
    path: "/gate-test/search",
    use: [$ownsProject({ param: "projectId", from: "query" })],
    schema: {
      query: z.object({ projectId: z.integer() }),
      response: z.text(),
    },
    handler: async () => this.owned.authority<Project>().title,
  });
}

interface TestContext {
  alepha: Alepha;
  controller: GateTestController;
  repos: TestEntityRepositories;
}

/**
 * Pinned `DATABASE_URL`, like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider refuses outright.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);
  alepha.with(GateTestController);

  const repos = alepha.inject(TestEntityRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(GateTestController),
    repos,
  };
};

const ownerToken = (project: Project): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

const strangerToken = (): UserAccountToken => ({
  id: crypto.randomUUID(),
  roles: ["user"],
});

const memberToken = async (
  ctx: TestContext,
  project: Project,
): Promise<UserAccountToken> => {
  const user = await ctx.repos.users.create({});
  await createTestMember(ctx.alepha, project, user.id, { owner: false });
  return { id: user.id, roles: ["user"] };
};

describe("$ownsProject", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("when the param names the project", () => {
    it("admits the creator", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);

      const title = await ctx.controller.readProject(
        { params: { projectId: project.id } },
        { user: ownerToken(project) },
      );

      expect(title).toBe(project.title);
    });

    it("admits a member", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = await memberToken(ctx, project);

      const title = await ctx.controller.readProject(
        { params: { projectId: project.id } },
        { user },
      );

      expect(title).toBe(project.title);
    });

    it("refuses a stranger", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);

      await expect(
        ctx.controller.readProject(
          { params: { projectId: project.id } },
          { user: strangerToken() },
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it("keeps the message the service used", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);

      await expect(
        ctx.controller.readProject(
          { params: { projectId: project.id } },
          { user: strangerToken() },
        ),
      ).rejects.toThrow("Not a member of this project");
    });
  });

  describe("when the param names a row that has a project", () => {
    it("admits a member of the project the row belongs to", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      const user = await memberToken(ctx, project);

      const result = await ctx.controller.readEpic(
        { params: { id: epic.id } },
        { user },
      );

      // Both rows reached the handler: the epic on `get()`, its project on
      // `authority()`, neither re-queried.
      expect(result).toBe(`${epic.title} in ${project.title}`);
    });

    it("refuses a member of a DIFFERENT project", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      const other = await createTestProject(ctx.alepha);
      const user = await memberToken(ctx, other);

      await expect(
        ctx.controller.readEpic({ params: { id: epic.id } }, { user }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("refuses a stranger", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);

      await expect(
        ctx.controller.readEpic(
          { params: { id: epic.id } },
          { user: strangerToken() },
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("the owner variant", () => {
    it("admits the creator", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);

      const title = await ctx.controller.readProjectAsOwner(
        { params: { projectId: project.id } },
        { user: ownerToken(project) },
      );

      expect(title).toBe(project.title);
    });

    it("refuses a plain member, which the member variant admits", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = await memberToken(ctx, project);

      // The same caller, the same project, both variants — this is the pair
      // that proves `owner: true` drops `via` rather than adding a check that
      // happens to pass for the creator.
      expect(
        await ctx.controller.readProject(
          { params: { projectId: project.id } },
          { user },
        ),
      ).toBe(project.title);

      await expect(
        ctx.controller.readProjectAsOwner(
          { params: { projectId: project.id } },
          { user },
        ),
      ).rejects.toThrow("Only the project owner can perform this action");
    });

    it("refuses a member on the hop branch too", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      const user = await memberToken(ctx, project);

      await expect(
        ctx.controller.readEpicAsOwner({ params: { id: epic.id } }, { user }),
      ).rejects.toThrow(ForbiddenError);

      expect(
        await ctx.controller.readEpicAsOwner(
          { params: { id: epic.id } },
          { user: ownerToken(project) },
        ),
      ).toBe(project.title);
    });
  });

  describe("when the id is in the query string", () => {
    it("admits a member", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = await memberToken(ctx, project);

      const title = await ctx.controller.searchByQuery(
        { query: { projectId: project.id } },
        { user },
      );

      expect(title).toBe(project.title);
    });

    it("refuses a stranger", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);

      await expect(
        ctx.controller.searchByQuery(
          { query: { projectId: project.id } },
          { user: strangerToken() },
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
