import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { type Estate, estates } from "../src/api/entities/estates.ts";
import { LoreApi } from "../src/api/index.ts";
import { CloudflareProbeService } from "../src/api/services/CloudflareProbeService.ts";
import { CredentialSealService } from "../src/api/services/CredentialSealService.ts";
import { EstateCloudflareService } from "../src/api/services/EstateCloudflareService.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";
import { MemoryCloudflareProbeService } from "./fixtures/MemoryCloudflareProbeService.ts";

class EstateRepositories {
  estates = $repository(estates);
}

interface TestContext {
  alepha: Alepha;
  probes: MemoryCloudflareProbeService;
  cloudflare: EstateCloudflareService;
  seal: CredentialSealService;
  mail: MemoryEmailProvider;
  dateTime: DateTimeProvider;
  entities: TestEntityRepositories;
  repos: EstateRepositories;
}

const ACCOUNT = "0123456789abcdef0123456789abcdef";

const TOKEN = `cfut_${"a1B2c3D4e5".repeat(4)}0123abcd`;

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      DATABASE_URL: ":memory:",
      APP_SECRET: "estate-credential-sweep-secret",
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

  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(EstateRepositories);
  await alepha.start();

  return {
    alepha,
    probes: alepha.inject(MemoryCloudflareProbeService),
    cloudflare: alepha.inject(EstateCloudflareService),
    seal: alepha.inject(CredentialSealService),
    mail: alepha.inject(MemoryEmailProvider),
    dateTime: alepha.inject(DateTimeProvider),
    entities,
    repos,
  };
};

/**
 * The nightly sweep, asserted on END STATE.
 *
 * ⚠️ `dateTime.travel()` releases every `$job` cron in the container, so the
 * sweep runs here and so does everything else on `0 0 * * *`. Counting calls
 * would measure the harness; the rows and the mailbox are what the job is
 * for.
 */
describe("The nightly cloudflare credential sweep", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seed = async (slug: string): Promise<Estate> => {
    const owner = await ctx.entities.users.create({
      email: `${slug}@example.com`,
    });
    return ctx.repos.estates.create({
      ownerUserId: owner.id,
      type: "cloudflare",
      slug,
      accountId: ACCOUNT,
      credential: ctx.seal.seal(TOKEN, CredentialSealService.ESTATE_PURPOSE),
      credentialKeyVersion: CredentialSealService.KEY_VERSION,
      credentialCheckedAt: ctx.dateTime.now().toISOString(),
      deployAllowed: true,
    });
  };

  const rowOf = async (id: string): Promise<Estate> =>
    (await ctx.repos.estates.findOne({ where: { id: { eq: id } } })) as Estate;

  it("emails the owner once on the flip, and not again the next night", async ({
    expect,
  }) => {
    const estate = await seed("cf-flip");

    // Night one: everything still passes.
    await ctx.dateTime.travel(1, "day");
    expect(ctx.cloudflare.credentialStatus(await rowOf(estate.id))).toBe(
      "valid",
    );
    expect(ctx.mail.records).toHaveLength(0);

    // Night two: the token has been narrowed at Cloudflare.
    ctx.probes.refuse("/d1/database");
    await ctx.dateTime.travel(1, "day");

    const flipped = await rowOf(estate.id);
    expect(ctx.cloudflare.credentialStatus(flipped)).toBe("invalid");
    expect(flipped.credentialError).toContain("D1: Edit");
    expect(ctx.mail.records).toHaveLength(1);
    expect(ctx.mail.records[0]!.to).toBe("cf-flip@example.com");
    expect(ctx.mail.records[0]!.body).toContain("cf-flip");
    // The token itself never reaches an email body.
    expect(ctx.mail.records[0]!.body).not.toContain(TOKEN);

    // Night three: still invalid, and silent. The email is edge-triggered,
    // not a nightly nag; one line in the job changes that if it should be.
    await ctx.dateTime.travel(1, "day");
    expect(ctx.mail.records).toHaveLength(1);
  });

  it("isolates one estate's failure from the rest of the sweep", async ({
    expect,
  }) => {
    const broken = await seed("cf-broken");
    const healthy = await seed("cf-healthy");
    // A row whose credential cannot be opened at all: the sweep has to walk
    // past it rather than stop on the estates that come after it.
    await ctx.repos.estates.updateById(broken.id, {
      credential: "not:a:sealed-value",
    });

    await ctx.dateTime.travel(1, "day");

    expect(ctx.cloudflare.credentialStatus(await rowOf(healthy.id))).toBe(
      "valid",
    );
  });

  it("changes nothing and tells nobody when Cloudflare is down", async ({
    expect,
  }) => {
    const estate = await seed("cf-outage");
    ctx.probes.unreachable("/workers/scripts", 503);

    await ctx.dateTime.travel(1, "day");

    const row = await rowOf(estate.id);
    // The whole reason the verdict has three values: an outage at midnight
    // must not flip every estate in the instance and email every owner.
    expect(ctx.cloudflare.credentialStatus(row)).toBe("valid");
    expect(row.credentialError).toBeFalsy();
    expect(ctx.mail.records).toHaveLength(0);
  });
});
