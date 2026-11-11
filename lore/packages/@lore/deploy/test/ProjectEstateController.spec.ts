import { ProjectDeletionService, ProjectSecurityService } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import {
  AlephaServer,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreDeployApi } from "../src/api/index.ts";
import {
  EstateService,
  AppController,
  EstateController,
  ProjectEstateController,
} from "../src/api/index.ts";
import { estateProjects, estates } from "../src/schemas/index.ts";
import { createTestEstate } from "../src/testing/estates.ts";
import {
  createTestMemberByProjectId,
  createTestProject,
  DeployTestEntities,
} from "../src/testing/index.ts";

/**
 * `estates` and `estate_projects` are not part of `DeployTestEntities`,
 * so this spec registers them itself, pre-`start()`.
 */
class EstateRepositories {
  estates = $repository(estates);
  grants = $repository(estateProjects);
  projects = $repository(projects);
}

interface TestContext {
  alepha: Alepha;
  controller: ProjectEstateController;
  estates: EstateController;
  service: EstateService;
  repos: EstateRepositories;
  entities: DeployTestEntities;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreDeployApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(EstateRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(ProjectEstateController),
    estates: alepha.inject(EstateController),
    service: alepha.inject(EstateService),
    repos,
    entities,
  };
};

const createUser = async (
  ctx: TestContext,
  username: string,
): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({ username });
  return { id: user.id, roles: ["user"] };
};

/**
 * A project owned by `owner`, with `members` added as plain members.
 */
const createProject = async (
  ctx: TestContext,
  owner: UserAccountToken,
  members: UserAccountToken[] = [],
) => {
  const project = await createTestProject(ctx.alepha, {
    createdBy: owner.id,
  });
  for (const member of members) {
    await createTestMemberByProjectId(ctx.alepha, project.id, member.id);
  }
  return project;
};

const mintEstate = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
) => createTestEstate(ctx.alepha, user, { slug });

describe("ProjectEstateController, lending", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lends an estate only with estate:lend in the borrowing project and in its home", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const grace = await createUser(ctx, "grace");
    const project = await createProject(ctx, ada, [grace]);
    const mine = await mintEstate(ctx, ada, "ovh-1");
    const hers = await mintEstate(ctx, grace, "hetzner-1");
    const params = { projectId: project.id };

    const lent = await ctx.controller.attachEstate(
      { params, body: { estateId: mine.id } },
      { user: ada },
    );
    expect(lent.slug).toBe("ovh-1");
    expect(lent.home?.id).toBe(mine.projectId);
    expect(lent.isHome).toBe(false);
    expect(lent).not.toHaveProperty("secretPrefix");

    // A plain member of the borrowing project cannot lend into it, even an
    // estate of their own project: attaching changes what it deploys to.
    await expect(
      ctx.controller.attachEstate(
        { params, body: { estateId: hers.id } },
        { user: grace },
      ),
    ).rejects.toThrow(ForbiddenError);

    // The borrowing project's owner cannot lend an estate of a project they
    // are not in: the home's rank is asked too.
    await expect(
      ctx.controller.attachEstate(
        { params, body: { estateId: hers.id } },
        { user: ada },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("is whoever holds estate:lend, not only the project owner", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const grace = await createUser(ctx, "grace");
    const project = await createProject(ctx, ada);
    await ctx.alepha.inject(RankService).save(
      await ctx.alepha
        .inject(ProjectSecurityService)
        .organizationIdOf(project.id),
      {
        key: "lender",
        name: "Lender",
        permissions: ["project:read", "estate:read", "estate:lend"],
      },
      ada,
    );
    await createTestMemberByProjectId(ctx.alepha, project.id, grace.id, {
      rank: "lender",
    });
    const hers = await mintEstate(ctx, grace, "hetzner-1");
    const adas = await mintEstate(ctx, ada, "ovh-1");
    const params = { projectId: project.id };

    const lent = await ctx.controller.attachEstate(
      { params, body: { estateId: hers.id } },
      { user: grace },
    );
    expect(lent.slug).toBe("hetzner-1");

    // Taking back an estate somebody else lent is the same permission.
    await ctx.controller.attachEstate(
      { params, body: { estateId: adas.id } },
      { user: ada },
    );
    await ctx.controller.detachEstate(
      { params: { ...params, estateId: adas.id } },
      { user: grace },
    );
    expect(
      await ctx.repos.grants.count({
        estateId: { eq: adas.id },
        projectId: { eq: project.id },
      }),
    ).toBe(0);
  });

  it("refuses lending the same estate twice", async ({ expect }) => {
    const ada = await createUser(ctx, "ada");
    const project = await createProject(ctx, ada);
    const mine = await mintEstate(ctx, ada, "ovh-1");
    const params = { projectId: project.id };

    await ctx.controller.attachEstate(
      { params, body: { estateId: mine.id } },
      { user: ada },
    );
    await expect(
      ctx.controller.attachEstate(
        { params, body: { estateId: mine.id } },
        { user: ada },
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("creates an estate from inside the project and lends it in one step, with the secret once", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const project = await createProject(ctx, ada);

    const minted = await ctx.controller.createProjectEstate(
      { params: { projectId: project.id }, body: { slug: "OVH-2" } },
      { user: ada },
    );

    expect(minted.secret!.startsWith("est_")).toBe(true);
    expect(minted.slug).toBe("ovh-2");
    expect(minted.isHome).toBe(true);
    expect(minted.home?.id).toBe(project.id);

    const held = await ctx.controller.listProjectEstates(
      { params: { projectId: project.id } },
      { user: ada },
    );
    expect(held.items.map((item) => item.id)).toEqual([minted.id]);

    // Homed in the project, and on the account page of its members.
    const own = await ctx.estates.listMyEstates({}, { user: ada });
    expect(own.items.map((item) => item.id)).toEqual([minted.id]);
  });
});

describe("ProjectEstateController, what a member may learn", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("shows a member what the project holds, and nothing of the home's other estates", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const grace = await createUser(ctx, "grace");
    const hal = await createUser(ctx, "hal");
    const project = await createProject(ctx, ada, [grace]);
    const lent = await mintEstate(ctx, ada, "ovh-1");
    await mintEstate(ctx, ada, "ovh-2");
    const hers = await mintEstate(ctx, grace, "hetzner-1");
    await ctx.controller.attachEstate(
      { params: { projectId: project.id }, body: { estateId: lent.id } },
      { user: ada },
    );

    const seen = await ctx.controller.listProjectEstates(
      { params: { projectId: project.id } },
      { user: grace },
    );
    expect(seen.items.map((item) => item.slug)).toEqual(["ovh-1"]);
    expect(seen.items[0].home?.id).toBe(lent.projectId);
    // Not a member of the home: the console is not theirs to open.
    expect(seen.items[0].can).toEqual([]);
    expect(seen.items[0]).not.toHaveProperty("secretPrefix");
    expect(seen.items[0]).not.toHaveProperty("secretHash");

    // The picker is the estates of the caller's projects: hers, never ada's.
    const pick = await ctx.estates.listMyEstates({}, { user: grace });
    expect(pick.items.map((item) => item.id)).toEqual([hers.id]);

    // A stranger to the project sees nothing at all.
    await expect(
      ctx.controller.listProjectEstates(
        { params: { projectId: project.id } },
        { user: hal },
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("ProjectEstateController, detaching", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("refuses while a copy deploys there, and lifts once it is repointed", async ({
    expect,
  }) => {
    // ⚠️ The whole sequence the e2e drives, in one place: point, refuse, clear,
    // detach. `EstateService.assertUnreferenced` and `AppService.setEstate`
    // read and write the same column through two different repositories, so a
    // refusal that never lifted would look exactly like a clear that never
    // landed.
    const ada = await createUser(ctx, "ada");
    const estate = await mintEstate(ctx, ada, "ovh-1");
    const project = await createProject(ctx, ada, []);
    await ctx.controller.attachEstate(
      { params: { projectId: project.id }, body: { estateId: estate.id } },
      { user: ada },
    );

    const apps = ctx.alepha.inject(AppController);
    await apps.createApp(
      {
        params: { projectId: project.id },
        body: { app: "acme", env: "production" },
      },
      { user: ada },
    );
    await apps.updateApp(
      {
        params: { projectId: project.id, app: "acme", env: "production" },
        body: { estateId: estate.id },
      },
      { user: ada },
    );

    await expect(
      ctx.controller.detachEstate(
        { params: { projectId: project.id, estateId: estate.id } },
        { user: ada },
      ),
    ).rejects.toThrow(/acme\/production/);

    await apps.updateApp(
      {
        params: { projectId: project.id, app: "acme", env: "production" },
        body: { estateId: null },
      },
      { user: ada },
    );

    await ctx.controller.detachEstate(
      { params: { projectId: project.id, estateId: estate.id } },
      { user: ada },
    );
  });

  it("takes either owner, and refuses a plain member", async ({ expect }) => {
    const ada = await createUser(ctx, "ada");
    const grace = await createUser(ctx, "grace");
    const hal = await createUser(ctx, "hal");
    const mine = await mintEstate(ctx, ada, "ovh-1");

    // ada's own project: she is both owners.
    const own = await createProject(ctx, ada, [grace]);
    await ctx.controller.attachEstate(
      { params: { projectId: own.id }, body: { estateId: mine.id } },
      { user: ada },
    );
    await expect(
      ctx.controller.detachEstate(
        { params: { projectId: own.id, estateId: mine.id } },
        { user: grace },
      ),
    ).rejects.toThrow(ForbiddenError);
    await ctx.controller.detachEstate(
      { params: { projectId: own.id, estateId: mine.id } },
      { user: ada },
    );
    expect(
      (
        await ctx.controller.listProjectEstates(
          { params: { projectId: own.id } },
          { user: ada },
        )
      ).items,
    ).toEqual([]);

    // hal's project holding ada's estate (granted directly, as a future
    // ownership transfer could leave it): the estate owner may withdraw.
    const theirs = await createProject(ctx, hal, [ada, grace]);
    await ctx.repos.grants.create({
      projectId: theirs.id,
      estateId: mine.id,
      createdBy: hal.id,
    });
    await expect(
      ctx.controller.detachEstate(
        { params: { projectId: theirs.id, estateId: mine.id } },
        { user: grace },
      ),
    ).rejects.toThrow(ForbiddenError);
    await ctx.controller.detachEstate(
      { params: { projectId: theirs.id, estateId: mine.id } },
      { user: ada },
    );
    expect(await ctx.repos.grants.count({ projectId: { eq: theirs.id } })).toBe(
      0,
    );
  });

  it("answers 404 for a loan that does not exist", async ({ expect }) => {
    const ada = await createUser(ctx, "ada");
    const project = await createProject(ctx, ada);
    const mine = await mintEstate(ctx, ada, "ovh-1");

    await expect(
      ctx.controller.detachEstate(
        { params: { projectId: project.id, estateId: mine.id } },
        { user: ada },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("counts the estates with no home an account takes with it, and their loans", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const first = await createProject(ctx, ada);
    const second = await createProject(ctx, ada);
    // Homed: outlives the account, not counted.
    await mintEstate(ctx, ada, "ovh-1");
    const loose = await ctx.repos.estates.create({
      ownerUserId: ada.id,
      createdBy: ada.id,
      type: "bay",
      slug: "loose",
    });
    for (const project of [first, second]) {
      await ctx.repos.grants.create({
        estateId: loose.id,
        projectId: project.id,
      });
    }

    expect(await ctx.service.countOwned(ada.id)).toEqual({
      estates: 1,
      projects: 2,
    });
  });

  /**
   * Only the estate half is asserted here. A project soft-deletes, so its
   * grants survive until `ProjectDeletionService` reclaims the row, and the
   * FK cascade on `projectId` fires only then.
   */
  it("loses the loan with the estate, and undeploys nothing", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const project = await createProject(ctx, ada);
    const one = await mintEstate(ctx, ada, "ovh-1");
    await ctx.controller.attachEstate(
      { params: { projectId: project.id }, body: { estateId: one.id } },
      { user: ada },
    );

    await ctx.estates.deleteEstate(
      { params: { estateId: one.id } },
      { user: ada },
    );

    expect(await ctx.repos.grants.count({ estateId: { eq: one.id } })).toBe(0);
    expect(
      (
        await ctx.controller.listProjectEstates(
          { params: { projectId: project.id } },
          { user: ada },
        )
      ).items,
    ).toEqual([]);
  });
});

/**
 * A deleted project lets go of its estates (#Q3169): the owner's project
 * delete is soft, so nothing cascades, and the walk of epic E116 found an
 * estate no command could delete any more because a gone project's copy
 * still pointed at it.
 */
describe("a deleted project frees its estates", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lets the estate be deleted once the project that deployed there is gone", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const estate = await mintEstate(ctx, ada, "ovh-1");
    const project = await createProject(ctx, ada, []);
    await ctx.controller.attachEstate(
      { params: { projectId: project.id }, body: { estateId: estate.id } },
      { user: ada },
    );
    const apps = ctx.alepha.inject(AppController);
    await apps.createApp(
      {
        params: { projectId: project.id },
        body: { app: "acme", env: "production" },
      },
      { user: ada },
    );
    await apps.updateApp(
      {
        params: { projectId: project.id, app: "acme", env: "production" },
        body: { estateId: estate.id },
      },
      { user: ada },
    );
    await expect(
      ctx.estates.deleteEstate(
        { params: { estateId: estate.id } },
        { user: ada },
      ),
    ).rejects.toThrow(/acme\/production/);

    await ctx.alepha.inject(ProjectDeletionService).deleteProject(project.id);

    expect(
      await ctx.repos.grants.findMany({
        where: { projectId: { eq: project.id } },
      }),
    ).toEqual([]);
    await ctx.estates.deleteEstate(
      { params: { estateId: estate.id } },
      { user: ada },
    );
    expect(
      await ctx.repos.estates.findOne({ where: { id: { eq: estate.id } } }),
    ).toBeUndefined();
  });

  it("does not let a copy left by a project deleted before that step hold the estate", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const estate = await mintEstate(ctx, ada, "ovh-2");
    const project = await createProject(ctx, ada, []);
    const apps = ctx.alepha.inject(AppController);
    await apps.createApp(
      {
        params: { projectId: project.id },
        body: { app: "acme", env: "production" },
      },
      { user: ada },
    );
    await ctx.controller.attachEstate(
      { params: { projectId: project.id }, body: { estateId: estate.id } },
      { user: ada },
    );
    await apps.updateApp(
      {
        params: { projectId: project.id, app: "acme", env: "production" },
        body: { estateId: estate.id },
      },
      { user: ada },
    );
    // Soft-deleted the way production's orphans were: the row alone, with
    // the copy still pointing at the estate.
    await ctx.repos.projects.deleteById(project.id);

    await ctx.estates.deleteEstate(
      { params: { estateId: estate.id } },
      { user: ada },
    );
  });
});
