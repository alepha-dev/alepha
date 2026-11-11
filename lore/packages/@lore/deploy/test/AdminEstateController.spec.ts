import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ForbiddenError, NotFoundError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreDeployApi } from "../src/api/index.ts";
import {
  EstateTokenService,
  AdminEstateController,
  EstateController,
} from "../src/api/index.ts";
import { estateProjects, estates } from "../src/schemas/index.ts";
import { createTestEstate } from "../src/testing/estates.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class EstateRepositories {
  estates = $repository(estates);
  grants = $repository(estateProjects);
}

interface TestContext {
  alepha: Alepha;
  admin: AdminEstateController;
  owner: EstateController;
  tokens: EstateTokenService;
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
    admin: alepha.inject(AdminEstateController),
    owner: alepha.inject(EstateController),
    tokens: alepha.inject(EstateTokenService),
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

const adminToken = (): UserAccountToken => ({
  id: crypto.randomUUID(),
  roles: ["admin"],
});

// Pages are zero-based, like every paginate() caller in the app.
const page = { page: 0, size: 20 };

describe("AdminEstateController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lists every estate on the instance, masked, with its home, its creator and its loans", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const bob = await createUser(ctx, "bob");
    const project = await createTestProject(ctx.alepha);
    const mine = await createTestEstate(ctx.alepha, alice, { slug: "ovh-1" });
    await createTestEstate(ctx.alepha, alice, { slug: "ovh-2" });
    await createTestEstate(ctx.alepha, bob, { slug: "hetzner" });
    await ctx.repos.grants.create({
      estateId: mine.id,
      projectId: project.id,
      createdBy: alice.id,
    });

    const result = await ctx.admin.findEstates(
      { query: page },
      { user: adminToken() },
    );
    expect(result.content).toHaveLength(3);

    const row = result.content.find((item) => item.id === mine.id);
    expect(row).toMatchObject({
      slug: "ovh-1",
      type: "bay",
      project: { id: mine.projectId },
      creator: { id: alice.id, name: "alice" },
      online: false,
      deployAllowed: false,
    });
    // Lent to its home when created, then to the other project.
    expect(row?.loans.map((loan) => loan.id)).toEqual([
      mine.projectId,
      project.id,
    ]);
    expect(row?.secretPrefix).toBe(mine.secretPrefix);
    // The masking rule has no exception for the admin role: no hash and no
    // secret on any row, ever.
    for (const item of result.content) {
      expect(Object.keys(item)).not.toContain("secretHash");
      expect(Object.keys(item)).not.toContain("secret");
    }
    expect(
      result.content.find((item) => item.slug === "hetzner")?.loans,
    ).toHaveLength(1);
  });

  it("filters the estates with no home, naming their creator and their loans", async ({
    expect,
  }) => {
    const dan = await createUser(ctx, "dan");
    const project = await createTestProject(ctx.alepha);
    await createTestEstate(ctx.alepha, dan, { slug: "homed" });
    // What the migration leaves for an estate lent only to somebody else's
    // project: no home, anchored on its creator.
    const loose = await ctx.repos.estates.create({
      ownerUserId: dan.id,
      createdBy: dan.id,
      type: "bay",
      slug: "loose",
    });
    await ctx.repos.grants.create({
      estateId: loose.id,
      projectId: project.id,
    });

    const result = await ctx.admin.findEstates(
      { query: { ...page, homeless: true } },
      { user: adminToken() },
    );
    expect(result.content.map((item) => item.slug)).toEqual(["loose"]);
    expect(result.content[0]).toMatchObject({
      creator: { id: dan.id, name: "dan" },
      loans: [{ id: project.id }],
    });
    expect(result.content[0]).not.toHaveProperty("project");
  });

  it("narrows by slug", async ({ expect }) => {
    const alice = await createUser(ctx, "alice");
    await createTestEstate(ctx.alepha, alice, { slug: "ovh-1" });
    await createTestEstate(ctx.alepha, alice, { slug: "hetzner" });

    const result = await ctx.admin.findEstates(
      { query: { ...page, search: "hetz" } },
      { user: adminToken() },
    );
    expect(result.content.map((item) => item.slug)).toEqual(["hetzner"]);
  });

  it("is closed to a plain user, owner of estates or not", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    await createTestEstate(ctx.alepha, alice, { slug: "ovh-1" });

    await expect(
      ctx.admin.findEstates({ query: page }, { user: alice }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("deletes an estate whoever owns it, which revokes its secret", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const minted = await createTestEstate(ctx.alepha, alice, { slug: "ovh-1" });
    expect(await ctx.tokens.verify(minted.secret)).toBeDefined();

    await ctx.admin.adminDeleteEstate(
      { params: { id: minted.id } },
      { user: adminToken() },
    );

    expect(await ctx.tokens.verify(minted.secret)).toBeUndefined();
    expect(
      await ctx.repos.estates.findOne({ where: { id: { eq: minted.id } } }),
    ).toBeUndefined();
    await expect(
      ctx.admin.adminDeleteEstate(
        { params: { id: crypto.randomUUID() } },
        { user: adminToken() },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
