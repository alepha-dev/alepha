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
 * Poll until `predicate` holds, or throw.
 *
 * ⚠️ Required since the sweep became a fan-out (2026-09-20): the cron
 * pushes and the per-estate job does the work, so nothing the cron tick
 * touches has happened when `travel()` resolves. A fixed sleep races the
 * queue under CI load; this is the same helper shape `$job.spec.ts` uses,
 * and the reason both exist.
 */
const waitFor = async <T>(
  read: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  label: string,
  timeout = 5000,
): Promise<T> => {
  const deadline = Date.now() + timeout;
  let last = await read();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
    last = await read();
  }
  if (predicate(last)) return last;
  throw new Error(`waitFor: ${label} did not hold within ${timeout}ms`);
};

/**
 * The nightly sweep, asserted on END STATE.
 *
 * ⚠️ `dateTime.travel()` releases every `$job` cron in the container, so the
 * sweep runs here and so does everything else on `0 3 * * *`. Counting calls
 * would measure the harness; the rows and the mailbox are what the job is
 * for.
 *
 * ⚠️ **Every assertion needs a positive signal to wait on first**, because
 * the work is queued rather than inline. A negative ("no mail was sent")
 * proves nothing on its own - it is also true before the job runs at all -
 * so each case waits for something that can only be true once the per-estate
 * handler reached the point in question: a `credentialCheckedAt` that
 * advanced, or the probe path that decides the outcome appearing in
 * `probes.calls`.
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
    const seededAt = (await rowOf(estate.id)).credentialCheckedAt;

    // Night one: everything still passes. Waiting on the stamp is what
    // makes the empty mailbox below mean anything.
    await ctx.dateTime.travel(1, "day");
    const checked = await waitFor(
      () => rowOf(estate.id),
      (row) => row.credentialCheckedAt !== seededAt,
      "night one re-checked the estate",
    );
    expect(ctx.cloudflare.credentialStatus(checked)).toBe("valid");
    expect(ctx.mail.records).toHaveLength(0);

    // Night two: the token has been narrowed at Cloudflare.
    ctx.probes.refuse("/d1/database");
    await ctx.dateTime.travel(1, "day");

    const flipped = await waitFor(
      () => rowOf(estate.id),
      (row) => ctx.cloudflare.credentialStatus(row) === "invalid",
      "night two flipped the estate to invalid",
    );
    expect(flipped.credentialError).toContain("D1: Edit");
    await waitFor(
      () => ctx.mail.records,
      (records) => records.length === 1,
      "the owner was emailed once",
    );
    expect(ctx.mail.records[0]!.to).toBe("cf-flip@example.com");
    expect(ctx.mail.records[0]!.body).toContain("cf-flip");
    // The token itself never reaches an email body.
    expect(ctx.mail.records[0]!.body).not.toContain(TOKEN);

    // Night three: still invalid, and silent. The email is edge-triggered,
    // not a nightly nag; one line in the job changes that if it should be.
    const flippedAt = flipped.credentialCheckedAt;
    await ctx.dateTime.travel(1, "day");
    await waitFor(
      () => rowOf(estate.id),
      (row) => row.credentialCheckedAt !== flippedAt,
      "night three re-checked the estate",
    );
    expect(ctx.mail.records).toHaveLength(1);
  });

  it("isolates one estate's failure from the rest of the sweep", async ({
    expect,
  }) => {
    const broken = await seed("cf-broken");
    const healthy = await seed("cf-healthy");
    // A row whose credential cannot be opened at all. Isolation is
    // structural since the split - the two estates are separate executions,
    // so the broken one cannot reach the healthy one - and this pins that
    // the fan-out still queues past a row it cannot process.
    await ctx.repos.estates.updateById(broken.id, {
      credential: "not:a:sealed-value",
    });
    const seededAt = (await rowOf(healthy.id)).credentialCheckedAt;

    await ctx.dateTime.travel(1, "day");

    const row = await waitFor(
      () => rowOf(healthy.id),
      (it) => it.credentialCheckedAt !== seededAt,
      "the healthy estate was re-checked",
    );
    expect(ctx.cloudflare.credentialStatus(row)).toBe("valid");
  });

  it("changes nothing and tells nobody when Cloudflare is down", async ({
    expect,
  }) => {
    const estate = await seed("cf-outage");
    ctx.probes.unreachable("/workers/scripts", 503);

    await ctx.dateTime.travel(1, "day");

    // The probe that answers 503 is the one that decides the outcome, so
    // its appearance in `calls` is the signal that the handler got far
    // enough for the assertions below to mean anything.
    await waitFor(
      () => ctx.probes.calls,
      (calls) => calls.some((path) => path.endsWith("/workers/scripts")),
      "the estate was probed",
    );

    const row = await rowOf(estate.id);
    // The whole reason the verdict has three values: an outage at midnight
    // must not flip every estate in the instance and email every owner.
    expect(ctx.cloudflare.credentialStatus(row)).toBe("valid");
    expect(row.credentialError).toBeFalsy();
    expect(ctx.mail.records).toHaveLength(0);
  });
});
