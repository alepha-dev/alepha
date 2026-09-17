import { Alepha, AlephaError } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { TestEntityRepositories } from "../../../test/fixtures/entities.ts";
import { members as membersEntity } from "../entities/members.ts";
import { projects as projectsEntity } from "../entities/projects.ts";
import { LoreApi } from "../index.ts";
import { ProjectController } from "./ProjectController.ts";

/**
 * `createProject` with a membership write that refuses.
 *
 * The field is overridden rather than mocked: the parent's
 * `$repository(members)` initializer has already run (and already registered
 * the table with the schema sync) by the time this one replaces the value, so
 * the boot-time FK closure is unaffected and only the call site changes.
 *
 * The refusal is one-shot, so the retry that the handler's rethrow is asking
 * the caller to make can be exercised in the same container.
 */
class FailingMembersProjectController extends ProjectController {
  public failures = 0;

  /**
   * A second repository over the same table, not a capture of `this.members`:
   * the override below shadows that property, and TypeScript rightly refuses
   * to read it from an initializer. Two repositories over one entity is the
   * normal shape here — `TestEntityRepositories` already holds another.
   */
  protected readonly realMembers = $repository(membersEntity);

  /**
   * Only `create` refuses. Everything else falls through to the real
   * repository - the handler also COUNTS owner rows now, for the project
   * quota, and a fake that answered only `create` turned the compensating
   * delete into a `TypeError` before the write it is about ever ran.
   */
  override members = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === "create") {
          return async (...args: unknown[]) => {
            this.failures += 1;
            if (this.failures === 1) {
              throw new AlephaError("members.create refused");
            }
            return (this.realMembers.create as (...a: unknown[]) => unknown)(
              ...args,
            );
          };
        }
        const real = (this.realMembers as unknown as Record<string, unknown>)[
          prop
        ];
        return typeof real === "function" ? real.bind(this.realMembers) : real;
      },
    },
  ) as unknown as ProjectController["members"];
}

class FailingProjectSaveController extends ProjectController {
  protected readonly realProjects = $repository(projectsEntity);
  public failures = 0;

  override projects = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === "save") {
          return async (...args: unknown[]) => {
            this.failures += 1;
            if (this.failures === 1) {
              throw new AlephaError("projects.save refused");
            }
            return (this.realProjects.save as (...a: unknown[]) => unknown)(
              ...args,
            );
          };
        }
        const real = (this.realProjects as unknown as Record<string, unknown>)[
          prop
        ];
        return typeof real === "function" ? real.bind(this.realProjects) : real;
      },
    },
  ) as unknown as ProjectController["projects"];
}

interface TestContext {
  alepha: Alepha;
  controller: ProjectController;
  repos: TestEntityRepositories;
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config — the one CI
 * runs — sets `DATABASE_URL` to a Postgres URL, which this app's SQLite
 * provider rejects outright. A bare `Alepha.create()` passes under
 * `yarn w lore test` and fails under `yarn test`.
 */
const setup = async (
  options: { failMembership?: boolean; failProjectSave?: boolean } = {},
): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  if (options.failMembership) {
    alepha.with({
      provide: ProjectController,
      use: FailingMembersProjectController,
    });
  } else if (options.failProjectSave) {
    alepha.with({
      provide: ProjectController,
      use: FailingProjectSaveController,
    });
  }

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(ProjectController),
    repos,
  };
};

describe("ProjectController.createProject", () => {
  let ctx: TestContext;

  afterEach(async () => {
    await ctx?.alepha.stop();
  });

  it("creates the project, the membership row and the capability rows", async ({
    expect,
  }) => {
    ctx = await setup();
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };

    const resource = await ctx.controller.createProject(
      { body: { title: "A Real Project" } },
      { user },
    );

    expect(resource.slug).toBe("a-real-project");

    const membership = await ctx.repos.members.findOne({
      where: { projectId: { eq: resource.id }, userId: { eq: account.id } },
    });
    expect(membership).toBeDefined();

    const project = await ctx.repos.projects.getById(resource.id);
    expect(project.organizationId).toBeDefined();

    const organization = await ctx.repos.organizations.getById(
      project.organizationId!,
    );
    expect(organization.name).toBe("A Real Project");
    expect(organization.slug).toBeUndefined();
    expect(organization.logo).toBeUndefined();

    const organizationOwners = await ctx.repos.organizationMembers.findMany({
      where: {
        organizationId: { eq: organization.id },
        rank: { eq: "owner" },
      },
    });
    expect(organizationOwners).toHaveLength(1);
    expect(organizationOwners[0].userId).toBe(account.id);

    await ctx.alepha.context.run(async () => {
      ctx.alepha.store.set(currentUserAtom, user);
      await ctx.controller.updateProjectById({
        params: { id: resource.id },
        body: { title: "Renamed Project" },
      } as any);
    });

    const renamed = await ctx.repos.organizations.getById(organization.id);
    expect(renamed.name).toBe("Renamed Project");
    expect(renamed.slug).toBeUndefined();
    expect(renamed.logo).toBeUndefined();
  });

  it("leaves no project row behind when the membership write fails", async ({
    expect,
  }) => {
    ctx = await setup({ failMembership: true });
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };

    await expect(
      ctx.controller.createProject(
        { body: { title: "Doomed Project" } },
        { user },
      ),
    ).rejects.toThrow(AlephaError);

    // Nothing survives: on this driver `$transactional()` rolls the whole
    // handler back, and on a driver that cannot (D1) the compensating delete
    // in the handler is what empties this list.
    const projects = await ctx.repos.projects.findMany({
      where: { createdBy: { eq: account.id } },
    });
    expect(projects).toHaveLength(0);

    const organizations = await ctx.repos.organizations.findMany({});
    expect(organizations).toHaveLength(0);

    const organizationMembers = await ctx.repos.organizationMembers.findMany(
      {},
    );
    expect(organizationMembers).toHaveLength(0);
  });

  it("removes the organization when the fallback project write fails", async ({
    expect,
  }) => {
    ctx = await setup({ failProjectSave: true });
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };

    await expect(
      ctx.controller.createProject({ body: { title: "日本語" } }, { user }),
    ).rejects.toThrow(AlephaError);

    expect(await ctx.repos.projects.findMany({})).toHaveLength(0);
    expect(await ctx.repos.organizations.findMany({})).toHaveLength(0);
    expect(await ctx.repos.organizationMembers.findMany({})).toHaveLength(0);
  });

  it("frees the slug, so the same title can be created again after a failure", async ({
    expect,
  }) => {
    ctx = await setup({ failMembership: true });
    const account = await ctx.repos.users.create({});
    const user: UserAccountToken = { id: account.id, roles: ["user"] };

    await expect(
      ctx.controller.createProject(
        { body: { title: "Retried Project" } },
        { user },
      ),
    ).rejects.toThrow(AlephaError);

    const retried = await ctx.controller.createProject(
      { body: { title: "Retried Project" } },
      { user },
    );

    expect(retried.slug).toBe("retried-project");
  });
});
