import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ForbiddenError, NotFoundError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import { EstateTokenService } from "../services/EstateTokenService.ts";
import { AdminEstateController } from "./AdminEstateController.ts";
import { EstateController } from "./EstateController.ts";

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

  it("lists every estate on the instance, masked, with its owner and loan count", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const bob = await createUser(ctx, "bob");
    const project = await createTestProject(ctx.alepha);
    const mine = await ctx.owner.createEstate(
      { body: { slug: "ovh-1" } },
      { user: alice },
    );
    await ctx.owner.createEstate({ body: { slug: "ovh-2" } }, { user: alice });
    await ctx.owner.createEstate({ body: { slug: "hetzner" } }, { user: bob });
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
      ownerUserId: alice.id,
      ownerName: "alice",
      online: false,
      deployAllowed: false,
      projectCount: 1,
    });
    expect(row?.secretPrefix).toBe(mine.secretPrefix);
    // The masking rule has no exception for the admin role: no hash and no
    // secret on any row, ever.
    for (const item of result.content) {
      expect(Object.keys(item)).not.toContain("secretHash");
      expect(Object.keys(item)).not.toContain("secret");
    }
    expect(
      result.content.find((item) => item.slug === "hetzner")?.projectCount,
    ).toBe(0);
  });

  it("narrows by slug", async ({ expect }) => {
    const alice = await createUser(ctx, "alice");
    await ctx.owner.createEstate({ body: { slug: "ovh-1" } }, { user: alice });
    await ctx.owner.createEstate(
      { body: { slug: "hetzner" } },
      { user: alice },
    );

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
    await ctx.owner.createEstate({ body: { slug: "ovh-1" } }, { user: alice });

    await expect(
      ctx.admin.findEstates({ query: page }, { user: alice }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("deletes an estate whoever owns it, which revokes its secret", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const minted = await ctx.owner.createEstate(
      { body: { slug: "ovh-1" } },
      { user: alice },
    );
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
