import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { TestEntityRepositories } from "../../../test/fixtures/entities.ts";
import { MemoryCloudflareProbeService } from "../../../test/fixtures/MemoryCloudflareProbeService.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import { CloudflareProbeService } from "./CloudflareProbeService.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { EstateCloudflareService } from "./EstateCloudflareService.ts";

class EstateRepositories {
  estates = $repository(estates);
}

interface TestContext {
  alepha: Alepha;
  service: EstateCloudflareService;
  probes: MemoryCloudflareProbeService;
  seal: CredentialSealService;
  dateTime: DateTimeProvider;
  repos: EstateRepositories;
}

const ACCOUNT = "0123456789abcdef0123456789abcdef";

const USER_TOKEN = `cfut_${"a1B2c3D4e5".repeat(4)}0123abcd`;

const ACCOUNT_TOKEN = `cfat_${"z9Y8x7W6v5".repeat(4)}beef0123`;

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      DATABASE_URL: ":memory:",
      APP_SECRET: "estate-cloudflare-spec-secret",
    },
  });
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

  const repos = alepha.inject(EstateRepositories);
  alepha.inject(TestEntityRepositories);
  await alepha.start();

  return {
    alepha,
    service: alepha.inject(EstateCloudflareService),
    probes: alepha.inject(MemoryCloudflareProbeService),
    seal: alepha.inject(CredentialSealService),
    dateTime: alepha.inject(DateTimeProvider),
    repos,
  };
};

describe("EstateCloudflareService, the probe table", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * ⚠️ This case is the contract with #1517 and with the guide at
   * `/lore/docs/guides-cloudflare-token`. When #1517 learns what a Lore
   * deploy really calls, this list, the table on `EstateCloudflareService`
   * and that page change together. `yarn check:docs` cannot see the drift.
   */
  it("asks seven endpoints: identity, then one per permission group", async ({
    expect,
  }) => {
    const passed = await ctx.service.check({
      accountId: ACCOUNT,
      token: USER_TOKEN,
    });

    expect(passed.outcome).toBe("passed");
    expect(ctx.probes.calls).toEqual([
      "/user/tokens/verify",
      `/accounts/${ACCOUNT}`,
      `/accounts/${ACCOUNT}/workers/scripts`,
      `/accounts/${ACCOUNT}/d1/database`,
      `/accounts/${ACCOUNT}/storage/kv/namespaces`,
      `/accounts/${ACCOUNT}/r2/buckets`,
      `/accounts/${ACCOUNT}/queues`,
    ]);
    // No workers.dev subdomain probe: it proved the same group as `workers`
    // and answers error 10007 for an account that never registered one,
    // which a permission probe would read as a refusal.
    expect(ctx.probes.calls.some((it) => it.includes("subdomain"))).toBe(false);
    // No zone probe: every Lore deploy is a plain custom domain, which is an
    // account-level call under "Workers Scripts: Edit".
    expect(ctx.probes.calls.some((it) => it.includes("/zones"))).toBe(false);
  });

  it("verifies an account-owned token through the account endpoint", async ({
    expect,
  }) => {
    await ctx.service.check({ accountId: ACCOUNT, token: ACCOUNT_TOKEN });

    // A `cfat_` token is owned by the account and does not resolve through
    // `/user`, so the kind picks the endpoint.
    expect(ctx.probes.calls[0]).toBe(`/accounts/${ACCOUNT}/tokens/verify`);
  });

  it("names the permission group the failing probe proves", async ({
    expect,
  }) => {
    for (const [suffix, expected] of [
      ["/workers/scripts", "Workers Scripts: Edit"],
      ["/d1/database", "D1: Edit"],
      ["/storage/kv/namespaces", "Workers KV Storage: Edit"],
      ["/r2/buckets", "Workers R2 Storage: Edit"],
      ["/queues", "Queues: Edit"],
    ] as const) {
      ctx.probes.reset().refuse(suffix);

      const check = await ctx.service.check({
        accountId: ACCOUNT,
        token: USER_TOKEN,
      });

      // Cloudflare answers 10000 for every one of these, so the sentence
      // can only come from which probe was refused.
      expect(check).toMatchObject({ outcome: "failed", field: "token" });
      expect(check.outcome === "failed" && check.message).toContain(expected);
    }
  });

  it("names both readings of a failed account probe, against the account field", async ({
    expect,
  }) => {
    ctx.probes.refuse(`/accounts/${ACCOUNT}`);

    const check = await ctx.service.check({
      accountId: ACCOUNT,
      token: USER_TOKEN,
    });

    // "Valid token, wrong account id" is the more confusing failure and
    // looks identical on the wire to a missing permission, so the sentence
    // names both and the dialog puts it beside the account id.
    expect(check).toMatchObject({ outcome: "failed", field: "accountId" });
    expect(check.outcome === "failed" && check.message).toContain(ACCOUNT);
    expect(check.outcome === "failed" && check.message).toContain(
      "Account Settings: Read",
    );
  });

  it("tells expired, disabled and not-yet-valid apart", async ({ expect }) => {
    const cases = [
      [{ status: "expired" }, /expired/],
      [{ status: "disabled" }, /disabled/],
      [
        { status: "active", not_before: "2099-01-01T00:00:00Z" },
        /not valid before/,
      ],
    ] as const;

    for (const [result, expected] of cases) {
      ctx.probes.reset().identity(result as Record<string, unknown>);

      const check = await ctx.service.check({
        accountId: ACCOUNT,
        token: USER_TOKEN,
      });

      // Three sentences, none of which is a missing permission: a person
      // told "add a permission" to a revoked token looks in the wrong place.
      expect(check.outcome).toBe("failed");
      expect(check.outcome === "failed" && check.message).toMatch(expected);
    }
  });

  it("keeps the expiry the verify endpoint reports", async ({ expect }) => {
    ctx.probes.identity({
      status: "active",
      expires_on: "2030-01-01T00:00:00Z",
    });

    const check = await ctx.service.check({
      accountId: ACCOUNT,
      token: USER_TOKEN,
    });

    expect(check).toEqual({
      outcome: "passed",
      expiresAt: "2030-01-01T00:00:00Z",
    });
  });

  it("answers inconclusive for a 429, a 5xx and a dead connection", async ({
    expect,
  }) => {
    for (const status of [0, 429, 500, 503]) {
      ctx.probes.reset().unreachable("/d1/database", status);

      const check = await ctx.service.check({
        accountId: ACCOUNT,
        token: USER_TOKEN,
      });

      // None of these is evidence about the token. Reading any of them as
      // "invalid" is how a Cloudflare outage becomes a fleet of dead
      // estates and an email to every owner.
      expect(check).toEqual({
        outcome: "inconclusive",
        message: EstateCloudflareService.UNREACHABLE,
      });
    }
  });
});

describe("EstateCloudflareService, recheck and status", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * A cloudflare row as `createCloudflare` writes one: sealed credential,
   * account id, and a stamp saying it passed once. Sealed by the same
   * service the real path uses, so `recheck` opens it rather than reading a
   * fixture's plaintext.
   */
  const seed = async (slug: string, checkedAt: string): Promise<Estate> =>
    ctx.repos.estates.create({
      ownerUserId: (
        await ctx.alepha.inject(TestEntityRepositories).users.create({})
      ).id,
      type: "cloudflare",
      slug,
      accountId: ACCOUNT,
      credential: ctx.seal.seal(
        USER_TOKEN,
        CredentialSealService.ESTATE_PURPOSE,
      ),
      credentialKeyVersion: CredentialSealService.KEY_VERSION,
      credentialCheckedAt: checkedAt,
    });

  it("records a failure on the row and clears it on the next pass", async ({
    expect,
  }) => {
    const estate = await seed("cf-1", ctx.dateTime.now().toISOString());

    ctx.probes.refuse("/r2/buckets");
    const failed = await ctx.service.recheck(estate);
    expect(failed.outcome).toBe("failed");

    const invalid = (await ctx.repos.estates.findOne({
      where: { id: { eq: estate.id } },
    })) as Estate;
    expect(invalid.credentialError).toContain("Workers R2 Storage: Edit");
    expect(ctx.service.credentialStatus(invalid)).toBe("invalid");

    ctx.probes.reset();
    await ctx.service.recheck(invalid);

    const valid = (await ctx.repos.estates.findOne({
      where: { id: { eq: estate.id } },
    })) as Estate;
    // Cleared, not left behind: a row that passes tonight must not still
    // read "invalid" from a sentence written last night.
    expect(valid.credentialError).toBeFalsy();
    expect(ctx.service.credentialStatus(valid)).toBe("valid");
  });

  it("leaves the row untouched when Cloudflare could not be reached", async ({
    expect,
  }) => {
    const estate = await seed("cf-2", "2026-09-01T00:00:00.000Z");

    ctx.probes.unreachable("/queues", 503);
    const check = await ctx.service.recheck(estate);

    expect(check.outcome).toBe("inconclusive");
    const row = (await ctx.repos.estates.findOne({
      where: { id: { eq: estate.id } },
    })) as Estate;
    // Not even the stamp: "Lore asked and could not hear" is not "Lore
    // checked this at midnight".
    expect(row.credentialCheckedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(row.credentialError).toBeFalsy();
  });

  it("reads an expiry in the past as invalid, at read time", async ({
    expect,
  }) => {
    // The sweep runs at midnight; a token that expires at noon has to read
    // invalid at noon, which only a read-time derivation can do.
    expect(
      ctx.service.credentialStatus({
        type: "cloudflare",
        credentialExpiresAt: "2020-01-01T00:00:00Z",
      } as Estate),
    ).toBe("invalid");
    expect(
      ctx.service.credentialStatus({
        type: "cloudflare",
        credentialExpiresAt: "2099-01-01T00:00:00Z",
      } as Estate),
    ).toBe("valid");
    // A bay estate has no credential to check, so it has no status either.
    expect(
      ctx.service.credentialStatus({ type: "bay" } as Estate),
    ).toBeUndefined();
  });
});
