import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ForbiddenError, NotFoundError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreShipApi } from "../src/api/index.ts";
import {
  HostTokenService,
  AdminHostController,
  HostController,
} from "../src/api/index.ts";
import { hostProjects, hosts } from "../src/schemas/index.ts";
import { createTestHost } from "../src/testing/hosts.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class HostRepositories {
  hosts = $repository(hosts);
  grants = $repository(hostProjects);
}

interface TestContext {
  alepha: Alepha;
  admin: AdminHostController;
  owner: HostController;
  tokens: HostTokenService;
  repos: HostRepositories;
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
  alepha.with(LoreShipApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(HostRepositories);

  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminHostController),
    owner: alepha.inject(HostController),
    tokens: alepha.inject(HostTokenService),
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

describe("AdminHostController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lists every host on the instance, masked, with its home, its creator and its loans", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const bob = await createUser(ctx, "bob");
    const project = await createTestProject(ctx.alepha);
    const mine = await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });
    await createTestHost(ctx.alepha, alice, { slug: "ovh-2" });
    await createTestHost(ctx.alepha, bob, { slug: "hetzner" });
    await ctx.repos.grants.create({
      hostId: mine.id,
      projectId: project.id,
      createdBy: alice.id,
    });

    const result = await ctx.admin.findHosts(
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

  it("filters the hosts with no home, naming their creator and their loans", async ({
    expect,
  }) => {
    const dan = await createUser(ctx, "dan");
    const project = await createTestProject(ctx.alepha);
    await createTestHost(ctx.alepha, dan, { slug: "homed" });
    // What the migration leaves for a host lent only to somebody else's
    // project: no home, anchored on its creator.
    const loose = await ctx.repos.hosts.create({
      ownerUserId: dan.id,
      createdBy: dan.id,
      type: "bay",
      slug: "loose",
    });
    await ctx.repos.grants.create({
      hostId: loose.id,
      projectId: project.id,
    });

    const result = await ctx.admin.findHosts(
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
    await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });
    await createTestHost(ctx.alepha, alice, { slug: "hetzner" });

    const result = await ctx.admin.findHosts(
      { query: { ...page, search: "hetz" } },
      { user: adminToken() },
    );
    expect(result.content.map((item) => item.slug)).toEqual(["hetzner"]);
  });

  it("is closed to a plain user, owner of hosts or not", async ({ expect }) => {
    const alice = await createUser(ctx, "alice");
    await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });

    await expect(
      ctx.admin.findHosts({ query: page }, { user: alice }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("deletes a host whoever owns it, which revokes its secret", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const minted = await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });
    expect(await ctx.tokens.verify(minted.secret)).toBeDefined();

    await ctx.admin.adminDeleteHost(
      { params: { id: minted.id } },
      { user: adminToken() },
    );

    expect(await ctx.tokens.verify(minted.secret)).toBeUndefined();
    expect(
      await ctx.repos.hosts.findOne({ where: { id: { eq: minted.id } } }),
    ).toBeUndefined();
    await expect(
      ctx.admin.adminDeleteHost(
        { params: { id: crypto.randomUUID() } },
        { user: adminToken() },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
