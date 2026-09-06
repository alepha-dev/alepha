import { Alepha } from "alepha";
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

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import { EstateService } from "../services/EstateService.ts";
import { AppController } from "./AppController.ts";
import { EstateController } from "./EstateController.ts";
import { ProjectEstateController } from "./ProjectEstateController.ts";

/**
 * `estates` and `estate_projects` are not part of `TestEntityRepositories`,
 * so this spec registers them itself, pre-`start()`.
 */
class EstateRepositories {
  estates = $repository(estates);
  grants = $repository(estateProjects);
}

interface TestContext {
  alepha: Alepha;
  controller: ProjectEstateController;
  estates: EstateController;
  service: EstateService;
  repos: EstateRepositories;
  entities: TestEntityRepositories;
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
  alepha.with(LoreApi);

  const entities = alepha.inject(TestEntityRepositories);
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
    await ctx.entities.members.create({
      userId: member.id,
      projectId: project.id,
      owner: false,
    });
  }
  return project;
};

const mintEstate = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
) => ctx.estates.createEstate({ body: { slug } }, { user });

describe("ProjectEstateController, lending", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lends an estate only when the caller owns both the estate and the project", async ({
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
    expect(lent.owner).toEqual({ id: ada.id, name: "ada" });
    expect(lent).not.toHaveProperty("secretPrefix");

    // A member who owns an estate cannot lend it into a project they do not
    // own: attaching changes what the project deploys to.
    await expect(
      ctx.controller.attachEstate(
        { params, body: { estateId: hers.id } },
        { user: grace },
      ),
    ).rejects.toThrow(ForbiddenError);

    // The project owner cannot lend somebody else's estate, and learns
    // nothing from trying: the id alone does not confirm it exists.
    await expect(
      ctx.controller.attachEstate(
        { params, body: { estateId: hers.id } },
        { user: ada },
      ),
    ).rejects.toThrow(NotFoundError);
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

    expect(minted.secret.startsWith("est_")).toBe(true);
    expect(minted.slug).toBe("ovh-2");
    expect(minted.owner.id).toBe(ada.id);

    const held = await ctx.controller.listProjectEstates(
      { params: { projectId: project.id } },
      { user: ada },
    );
    expect(held.items.map((item) => item.id)).toEqual([minted.id]);

    // It is the owner's estate like any other: on the account page too.
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

  it("shows a member what the project holds, and nothing of the owner's other estates", async ({
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
    expect(seen.items[0].owner.name).toBe("ada");
    expect(seen.items[0]).not.toHaveProperty("secretPrefix");
    expect(seen.items[0]).not.toHaveProperty("secretHash");

    // The picker is the caller's own list: grace sees hers, never ada's.
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
        body: { app: "club", env: "production" },
      },
      { user: ada },
    );
    await apps.updateApp(
      {
        params: { projectId: project.id, app: "club", env: "production" },
        body: { estateId: estate.id },
      },
      { user: ada },
    );

    await expect(
      ctx.controller.detachEstate(
        { params: { projectId: project.id, estateId: estate.id } },
        { user: ada },
      ),
    ).rejects.toThrow(/club\/production/);

    await apps.updateApp(
      {
        params: { projectId: project.id, app: "club", env: "production" },
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

  it("counts the projects an owner's estates are lent to", async ({
    expect,
  }) => {
    const ada = await createUser(ctx, "ada");
    const first = await createProject(ctx, ada);
    const second = await createProject(ctx, ada);
    const mine = await mintEstate(ctx, ada, "ovh-1");
    for (const project of [first, second]) {
      await ctx.controller.attachEstate(
        { params: { projectId: project.id }, body: { estateId: mine.id } },
        { user: ada },
      );
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
