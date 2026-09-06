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

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { MemoryCloudflareProbeService } from "../../../test/fixtures/MemoryCloudflareProbeService.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import { createEstateBodySchema } from "../schemas/createEstateBodySchema.ts";
import { CloudflareProbeService } from "../services/CloudflareProbeService.ts";
import { CredentialSealService } from "../services/CredentialSealService.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
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
  grants = $repository(estateProjects);
}

interface TestContext {
  alepha: Alepha;
  controller: EstateController;
  service: EstateService;
  tokens: EstateTokenService;
  crypto: CryptoProvider;
  seal: CredentialSealService;
  cloudflare: MemoryCloudflareProbeService;
  commands: EstateCommandService;
  repos: EstateRepositories;
  entities: TestEntityRepositories;
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config sets
 * `DATABASE_URL` to a Postgres URL, which this app's SQLite provider rejects.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    // `APP_SECRET` because `CredentialSealService` refuses the published
    // default in every environment, tests included (#1631).
    env: {
      LOG_LEVEL: "error",
      DATABASE_URL: ":memory:",
      APP_SECRET: "estate-controller-spec-secret",
    },
  });

  // Substituted BEFORE the module that registers the real one: a
  // substitution declared after the service is in use is refused.
  alepha.with({
    provide: CloudflareProbeService,
    use: MemoryCloudflareProbeService,
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
    seal: alepha.inject(CredentialSealService),
    cloudflare: alepha.inject(MemoryCloudflareProbeService),
    commands: alepha.inject(EstateCommandService),
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

/**
 * A real Cloudflare token shape: the marker, 40 alphanumerics and an 8-hex
 * checksum. Long enough to pass `cloudflareTokenSchema`, and shaped so the
 * mask assertions mean something.
 */
const CF_TOKEN = `cfut_${"a1B2c3D4e5".repeat(4)}0123abcd`;

const CF_ACCOUNT = "0123456789abcdef0123456789abcdef";

const createCloudflare = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
  token = CF_TOKEN,
) =>
  ctx.controller.createEstate(
    {
      body: {
        type: "cloudflare",
        slug,
        accountId: CF_ACCOUNT,
        token,
      },
    },
    { user },
  );

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

    expect(minted.secret!.startsWith("est_")).toBe(true);
    expect(minted.secretPrefix).toBe(minted.secret!.slice(0, 12));
    expect(minted).not.toHaveProperty("secretHash");
    expect(minted.type).toBe("bay");
    expect(minted.acceptedRuntimes).toEqual(["node"]);
    expect(minted.online).toBe(false);

    const row = (await ctx.repos.estates.findOne({
      where: { id: { eq: minted.id } },
    })) as Estate;
    expect(row.secretHash).toBe(ctx.crypto.hash(minted.secret!));

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

  it("seals a cloudflare token, masks it, and mints nothing", async ({
    expect,
  }) => {
    const user = await createUser(ctx);

    const created = await createCloudflare(ctx, user, "cf-1");

    // Nothing was minted, so nothing comes back. Absent rather than empty:
    // #1865's "the reveal dialog does not open" rests on the field being
    // missing, not on `Boolean("")`.
    expect(created).not.toHaveProperty("secret");
    expect(created.type).toBe("cloudflare");
    expect(created.acceptedRuntimes).toEqual(["workerd"]);
    expect(created.accountId).toBe(CF_ACCOUNT);
    // The kind marker plus eight characters, the bay rule: `cfut_` is five,
    // so a total of eight would name almost nothing.
    expect(created.secretPrefix).toBe(CF_TOKEN.slice(0, 13));
    // A Cloudflare account has no stats phase and exists to be deployed to.
    expect(created.deployAllowed).toBe(true);

    const row = (await ctx.repos.estates.findOne({
      where: { id: { eq: created.id } },
    })) as Estate;
    // On the row: sealed, never the token, and openable only in process.
    expect(row.credential).toBeTruthy();
    expect(row.credential).not.toContain(CF_TOKEN);
    expect(
      ctx.seal.open(row.credential!, CredentialSealService.ESTATE_PURPOSE),
    ).toBe(CF_TOKEN);
    expect(row.credentialKeyVersion).toBe(CredentialSealService.KEY_VERSION);
    // The check ran before the insert, so an estate that exists has passed.
    expect(row.credentialCheckedAt).toBeTruthy();
    expect(row.secretHash).toBeFalsy();
  });

  it("returns no credential on any read path, the owner included", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const created = await createCloudflare(ctx, user, "cf-1");

    const read = await ctx.controller.getEstate(
      { params: { estateId: created.id } },
      { user },
    );
    const listed = await ctx.controller.listMyEstates({}, { user });

    for (const resource of [created, read, listed.items[0]!]) {
      expect(resource).not.toHaveProperty("credential");
      expect(resource).not.toHaveProperty("credentialKeyVersion");
      expect(resource).not.toHaveProperty("secretHash");
      expect(resource.secretPrefix).toBe(CF_TOKEN.slice(0, 13));
      expect(resource.accountId).toBe(CF_ACCOUNT);
    }
  });

  it("writes no row when the check refuses the token", async ({ expect }) => {
    const user = await createUser(ctx);
    // Cloudflare refuses every missing permission with the same code, so the
    // probe that failed is what names the group.
    ctx.cloudflare.refuse("/d1/database");

    await expect(createCloudflare(ctx, user, "cf-1")).rejects.toThrow(/D1/);

    // Not a half-made estate that a later check could rescue: no row at all,
    // which is what lets `credentialStatus` have two values (#1630).
    expect(
      await ctx.repos.estates.findMany({ where: { slug: { eq: "cf-1" } } }),
    ).toHaveLength(0);
  });

  it("writes no row when Cloudflare could not be reached", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    ctx.cloudflare.unreachable("/queues");

    await expect(createCloudflare(ctx, user, "cf-1")).rejects.toThrow(
      /could not be reached/,
    );
    expect(
      await ctx.repos.estates.findMany({ where: { slug: { eq: "cf-1" } } }),
    ).toHaveLength(0);
  });

  it("replaces a token write-only, and leaves the old one on a failure", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const created = await createCloudflare(ctx, user, "cf-1");
    const replacement = `cfat_${"z9Y8x7W6v5".repeat(4)}beef0123`;

    ctx.cloudflare.identity({ status: "expired" });
    await expect(
      ctx.controller.replaceEstateCredential(
        { params: { estateId: created.id }, body: { token: replacement } },
        { user },
      ),
    ).rejects.toThrow(/expired/);

    // All or nothing: the token the owner already had keeps working.
    const untouched = (await ctx.repos.estates.findOne({
      where: { id: { eq: created.id } },
    })) as Estate;
    expect(
      ctx.seal.open(
        untouched.credential!,
        CredentialSealService.ESTATE_PURPOSE,
      ),
    ).toBe(CF_TOKEN);
    expect(untouched.secretPrefix).toBe(CF_TOKEN.slice(0, 13));

    ctx.cloudflare.reset();
    const replaced = await ctx.controller.replaceEstateCredential(
      { params: { estateId: created.id }, body: { token: replacement } },
      { user },
    );

    // The response is the masked resource and carries no token, in either
    // direction: nothing GETs one, nothing PATCHes one.
    expect(replaced).not.toHaveProperty("credential");
    expect(replaced.secretPrefix).toBe(replacement.slice(0, 13));
    const row = (await ctx.repos.estates.findOne({
      where: { id: { eq: created.id } },
    })) as Estate;
    expect(
      ctx.seal.open(row.credential!, CredentialSealService.ESTATE_PURPOSE),
    ).toBe(replacement);
  });

  it("answers 404 when somebody else replaces the token", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const stranger = await createUser(ctx);
    const created = await createCloudflare(ctx, owner, "cf-1");

    // The owner filter is the whole access rule: a non-owner learns nothing
    // an unknown id would not have told them.
    await expect(
      ctx.controller.replaceEstateCredential(
        { params: { estateId: created.id }, body: { token: CF_TOKEN } },
        { user: stranger },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses to rotate a cloudflare estate, and names the replace route", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const created = await createCloudflare(ctx, user, "cf-1");

    await expect(
      ctx.controller.rotateEstate(
        { params: { estateId: created.id } },
        { user },
      ),
    ).rejects.toThrow(/credential/);
  });

  it("refuses to replace the credential of a bay estate", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const minted = await createEstate(ctx, user, "ovh-1");

    await expect(
      ctx.controller.replaceEstateCredential(
        { params: { estateId: minted.id }, body: { token: CF_TOKEN } },
        { user },
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("refuses to queue a command for a cloudflare estate", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const created = await createCloudflare(ctx, user, "cf-1");
    const row = (await ctx.repos.estates.findOne({
      where: { id: { eq: created.id } },
    })) as Estate;

    // Without this the command would sit `pending` for a day and then fail
    // as "the machine never came for it", which is true about the wrong
    // thing: there is no machine, and epic #1 deploys over HTTP.
    await expect(
      ctx.commands.enqueue(row, {
        kind: "restart",
        payload: { app: "club", environment: "production" },
      }),
    ).rejects.toThrow(/Cloudflare/);
  });
});

describe("createEstateBodySchema", () => {
  // The handler cases above call the controller directly, which skips body
  // validation entirely. This is the half that runs over HTTP: what the
  // discriminated body accepts, and what it refuses before any handler sees
  // it.
  it("reads an omitted type as bay", async ({ expect }) => {
    // The shape the existing e2e sends (`estates.spec.ts` fills the slug and
    // submits, nothing else) and the one the Bay install guide documents.
    const parsed = createEstateBodySchema.parse({ slug: "ovh-1" });

    expect(parsed).toEqual({ slug: "ovh-1" });
  });

  it("requires an account id and a token for cloudflare", async ({
    expect,
  }) => {
    // There is no create-then-set path: a cloudflare estate without a token
    // is not a state the API can express.
    expect(() =>
      createEstateBodySchema.parse({ type: "cloudflare", slug: "cf-1" }),
    ).toThrow();
    expect(() =>
      createEstateBodySchema.parse({
        type: "cloudflare",
        slug: "cf-1",
        accountId: "not-an-account-id",
        token: CF_TOKEN,
      }),
    ).toThrow();
    expect(
      createEstateBodySchema.parse({
        type: "cloudflare",
        slug: "cf-1",
        accountId: CF_ACCOUNT,
        token: CF_TOKEN,
      }),
    ).toMatchObject({ type: "cloudflare", accountId: CF_ACCOUNT });
  });

  it("refuses a token on a bay body", async ({ expect }) => {
    // Extra keys are stripped rather than refused, which is what matters
    // here: a token sent to the bay branch is dropped, never sealed under a
    // row that has nowhere to put it.
    const parsed = createEstateBodySchema.parse({
      slug: "ovh-1",
      token: CF_TOKEN,
    });

    expect(parsed).not.toHaveProperty("token");
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

describe("EstateController, the owner's list", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("names the projects each estate is lent to, and nobody else's estates", async ({
    expect,
  }) => {
    const alice = await createUser(ctx);
    const bob = await createUser(ctx);
    const project = await createTestProject(ctx.alepha, { title: "Shop" });
    const lent = await createEstate(ctx, alice, "ovh-1");
    await createEstate(ctx, alice, "ovh-2");
    await createEstate(ctx, bob, "hetzner");
    await ctx.repos.grants.create({
      estateId: lent.id,
      projectId: project.id,
      createdBy: alice.id,
    });

    const { items } = await ctx.controller.listMyEstates({}, { user: alice });
    expect(items.map((item) => item.slug).sort()).toEqual(["ovh-1", "ovh-2"]);

    const withLoan = items.find((item) => item.id === lent.id);
    expect(withLoan?.projects).toHaveLength(1);
    expect(withLoan?.projects[0]).toMatchObject({
      id: project.id,
      title: "Shop",
      slug: project.slug,
    });
    expect(items.find((item) => item.slug === "ovh-2")?.projects).toEqual([]);
    // The secret never crosses, loans or not.
    for (const item of items) {
      expect(Object.keys(item)).not.toContain("secretHash");
    }
  });
});
