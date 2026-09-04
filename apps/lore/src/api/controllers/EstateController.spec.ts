import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { CryptoProvider } from "alepha/crypto";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import {
  AlephaServer,
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { TestEntityRepositories } from "../../../test/fixtures/entities.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import { EstateService } from "../services/EstateService.ts";
import { EstateTokenService } from "../services/EstateTokenService.ts";
import { EstateController } from "./EstateController.ts";

/**
 * `estates` is not part of `TestEntityRepositories`, so this spec registers it
 * itself, pre-`start()`, like everything else the schema sync has to see. Its
 * FK closure (`users`) is covered by that class.
 */
class EstateRepositories {
  estates = $repository(estates);
}

interface TestContext {
  alepha: Alepha;
  controller: EstateController;
  service: EstateService;
  tokens: EstateTokenService;
  crypto: CryptoProvider;
  repos: EstateRepositories;
  entities: TestEntityRepositories;
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config sets
 * `DATABASE_URL` to a Postgres URL, which this app's SQLite provider rejects.
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

  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(EstateRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(EstateController),
    service: alepha.inject(EstateService),
    tokens: alepha.inject(EstateTokenService),
    crypto: alepha.inject(CryptoProvider),
    repos,
    entities,
  };
};

const createUser = async (ctx: TestContext): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({});
  return { id: user.id, roles: ["user"] };
};

const createEstate = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
) => ctx.controller.createEstate({ body: { slug } }, { user });

describe("EstateController, the credential", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("mints a secret once, stores only its hash, and never returns it again", async ({
    expect,
  }) => {
    const user = await createUser(ctx);

    const minted = await createEstate(ctx, user, "ovh-1");

    expect(minted.secret.startsWith("est_")).toBe(true);
    expect(minted.secretPrefix).toBe(minted.secret.slice(0, 12));
    expect(minted).not.toHaveProperty("secretHash");
    expect(minted.type).toBe("bay");
    expect(minted.acceptedRuntimes).toEqual(["node"]);
    expect(minted.online).toBe(false);

    const row = (await ctx.repos.estates.findOne({
      where: { id: { eq: minted.id } },
    })) as Estate;
    expect(row.secretHash).toBe(ctx.crypto.hash(minted.secret));

    const listed = await ctx.controller.listMyEstates({}, { user });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).not.toHaveProperty("secret");
    expect(listed.items[0]).not.toHaveProperty("secretHash");
    expect(listed.items[0].secretPrefix).toBe(minted.secretPrefix);

    const one = await ctx.controller.getEstate(
      { params: { estateId: minted.id } },
      { user },
    );
    expect(one).not.toHaveProperty("secretHash");

    expect((await ctx.tokens.verify(minted.secret))?.id).toBe(minted.id);
    expect(await ctx.tokens.verify("est_nope")).toBeUndefined();
    expect(await ctx.tokens.verify(undefined)).toBeUndefined();
  });

  it("rotates: the old secret stops resolving and the new one resolves", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const minted = await createEstate(ctx, user, "ovh-1");

    const rotated = await ctx.controller.rotateEstate(
      { params: { estateId: minted.id } },
      { user },
    );

    expect(rotated.secret).not.toBe(minted.secret);
    expect(rotated.id).toBe(minted.id);
    expect(await ctx.tokens.verify(minted.secret)).toBeUndefined();
    expect((await ctx.tokens.verify(rotated.secret))?.id).toBe(minted.id);
  });

  it("reads a bearer header exactly, and nothing looser", ({ expect }) => {
    expect(ctx.tokens.bearer("Bearer est_abc")).toBe("est_abc");
    expect(ctx.tokens.bearer("Bearer   est_abc  ")).toBe("est_abc");
    expect(ctx.tokens.bearer("Basic est_abc")).toBeUndefined();
    expect(ctx.tokens.bearer("Bearer ")).toBeUndefined();
    expect(ctx.tokens.bearer(undefined)).toBeUndefined();
  });

  it("refuses a cloudflare estate until epic #22 lands", async ({ expect }) => {
    const user = await createUser(ctx);

    await expect(
      ctx.controller.createEstate(
        { body: { slug: "cf-1", type: "cloudflare" } },
        { user },
      ),
    ).rejects.toThrow(BadRequestError);
  });
});

describe("EstateController, the slug", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("keeps slugs unique per owner, not across owners", async ({ expect }) => {
    const ada = await createUser(ctx);
    const grace = await createUser(ctx);

    await createEstate(ctx, ada, "ovh-1");
    await expect(createEstate(ctx, ada, "ovh-1")).rejects.toThrow(
      ConflictError,
    );

    const theirs = await createEstate(ctx, grace, "ovh-1");
    expect(theirs.slug).toBe("ovh-1");
  });

  it("normalises the slug and refuses one that cannot be typed", async ({
    expect,
  }) => {
    const user = await createUser(ctx);

    const minted = await createEstate(ctx, user, "  OVH-1 ");
    expect(minted.slug).toBe("ovh-1");

    await expect(createEstate(ctx, user, "bad slug!")).rejects.toThrow(
      BadRequestError,
    );
    await expect(createEstate(ctx, user, "-leading")).rejects.toThrow(
      BadRequestError,
    );
  });

  it("holds the slug still and renames through the label", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const minted = await createEstate(ctx, user, "ovh-1");

    const updated = await ctx.controller.updateEstate(
      {
        params: { estateId: minted.id },
        // `slug` is not in the body schema and is stripped, never applied.
        body: { label: "The Paris box", slug: "renamed" } as any,
      },
      { user },
    );

    expect(updated.slug).toBe("ovh-1");
    expect(updated.label).toBe("The Paris box");
  });
});

describe("EstateController, ownership and switches", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers a non-owner as if the estate did not exist", async ({
    expect,
  }) => {
    const ada = await createUser(ctx);
    const grace = await createUser(ctx);
    const minted = await createEstate(ctx, ada, "ovh-1");
    const params = { estateId: minted.id };

    await expect(
      ctx.controller.getEstate({ params }, { user: grace }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      ctx.controller.updateEstate(
        { params, body: { deployAllowed: true } },
        { user: grace },
      ),
    ).rejects.toThrow(NotFoundError);
    await expect(
      ctx.controller.rotateEstate({ params }, { user: grace }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      ctx.controller.deleteEstate({ params }, { user: grace }),
    ).rejects.toThrow(NotFoundError);

    const theirs = await ctx.controller.listMyEstates({}, { user: grace });
    expect(theirs.items).toEqual([]);

    // Nothing above changed the row.
    const stillMine = await ctx.controller.getEstate({ params }, { user: ada });
    expect(stillMine.deployAllowed).toBe(false);
  });

  it("starts with every switch off and lets the owner flip them", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const minted = await createEstate(ctx, user, "ovh-1");

    expect(minted.collectSeries).toBe(false);
    expect(minted.deployAllowed).toBe(false);
    expect(minted.statsIntervalSeconds).toBe(1800);

    const updated = await ctx.controller.updateEstate(
      {
        params: { estateId: minted.id },
        body: {
          collectSeries: true,
          deployAllowed: true,
          statsIntervalSeconds: 300,
        },
      },
      { user },
    );

    expect(updated.collectSeries).toBe(true);
    expect(updated.deployAllowed).toBe(true);
    expect(updated.statsIntervalSeconds).toBe(300);
  });

  it("deletes an estate, which revokes its secret", async ({ expect }) => {
    const user = await createUser(ctx);
    const minted = await createEstate(ctx, user, "ovh-1");

    await ctx.controller.deleteEstate(
      { params: { estateId: minted.id } },
      { user },
    );

    expect(await ctx.tokens.verify(minted.secret)).toBeUndefined();
    expect((await ctx.controller.listMyEstates({}, { user })).items).toEqual(
      [],
    );
  });

  it("counts what an account deletion would take with it", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    await createEstate(ctx, user, "ovh-1");
    await createEstate(ctx, user, "ovh-2");

    expect(await ctx.controller.countMyEstates({}, { user })).toEqual({
      estates: 2,
      projects: 0,
    });
  });

  it("cascades an account deletion to its estates, the one exception to refusing", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    await createEstate(ctx, user, "ovh-1");

    await ctx.entities.users.deleteById(user.id);

    expect(
      await ctx.repos.estates.count({ ownerUserId: { eq: user.id } }),
    ).toBe(0);
  });
});

describe("EstateService.isOnline", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const at = (ms: number) => new Date(ms).toISOString();
  const base = Date.UTC(2026, 8, 4, 12, 0, 0);

  const estateWith = (overrides: Partial<Estate>): Estate =>
    ({
      id: "e",
      ownerUserId: "u",
      type: "bay",
      slug: "ovh-1",
      collectSeries: false,
      deployAllowed: false,
      statsIntervalSeconds: 1800,
      createdAt: at(base),
      updatedAt: at(base),
      ...overrides,
    }) as Estate;

  it("is offline until a connection was ever seen", ({ expect }) => {
    expect(ctx.service.isOnline(estateWith({}), base)).toBe(false);
  });

  it("is online while connected and recently heard from", ({ expect }) => {
    const estate = estateWith({
      connectedAt: at(base - 60_000),
      lastSeenAt: at(base - 30_000),
    });
    expect(ctx.service.isOnline(estate, base)).toBe(true);
  });

  it("is offline once a disconnect follows the connect", ({ expect }) => {
    const estate = estateWith({
      connectedAt: at(base - 60_000),
      disconnectedAt: at(base - 10_000),
      lastSeenAt: at(base - 5_000),
    });
    expect(ctx.service.isOnline(estate, base)).toBe(false);
  });

  it("is offline when the socket went silent for two intervals, whatever the stamps say", ({
    expect,
  }) => {
    const estate = estateWith({
      connectedAt: at(base - 4 * 3600_000),
      lastSeenAt: at(base - 2 * 1800_000 - 1000),
    });
    expect(ctx.service.isOnline(estate, base)).toBe(false);
  });

  it("derives runtimes from the type", ({ expect }) => {
    expect(ctx.service.acceptedRuntimes("bay")).toEqual(["node"]);
    expect(ctx.service.acceptedRuntimes("cloudflare")).toEqual(["workerd"]);
  });
});
