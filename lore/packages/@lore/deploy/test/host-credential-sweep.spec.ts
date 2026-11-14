import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreDeployApi } from "../src/api/index.ts";
import {
  CloudflareProbeService,
  CredentialSealService,
  HostCloudflareService,
} from "../src/api/index.ts";
import { type Host, hosts } from "../src/schemas/index.ts";
import { DeployTestEntities } from "../src/testing/index.ts";
import { MemoryCloudflareProbeService } from "../src/testing/index.ts";

class HostRepositories {
  hosts = $repository(hosts);
}

interface TestContext {
  alepha: Alepha;
  probes: MemoryCloudflareProbeService;
  cloudflare: HostCloudflareService;
  seal: CredentialSealService;
  mail: MemoryEmailProvider;
  dateTime: DateTimeProvider;
  entities: DeployTestEntities;
  repos: HostRepositories;
}

const ACCOUNT = "0123456789abcdef0123456789abcdef";

const TOKEN = `cfut_${"a1B2c3D4e5".repeat(4)}0123abcd`;

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      DATABASE_URL: ":memory:",
      APP_SECRET: "host-credential-sweep-secret",
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
  alepha.with(LoreDeployApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(HostRepositories);
  await alepha.start();

  return {
    alepha,
    probes: alepha.inject(MemoryCloudflareProbeService),
    cloudflare: alepha.inject(HostCloudflareService),
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
 * pushes and the per-host job does the work, so nothing the cron tick
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
 * so each case waits for something that can only be true once the per-host
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

  const seed = async (slug: string): Promise<Host> => {
    const owner = await ctx.entities.users.create({
      email: `${slug}@example.com`,
    });
    return ctx.repos.hosts.create({
      ownerUserId: owner.id,
      type: "cloudflare",
      slug,
      accountId: ACCOUNT,
      credential: await ctx.seal.seal(
        TOKEN,
        CredentialSealService.HOST_PURPOSE,
      ),
      credentialKeyVersion: CredentialSealService.KEY_VERSION,
      credentialCheckedAt: ctx.dateTime.now().toISOString(),
      deployAllowed: true,
    });
  };

  const rowOf = async (id: string): Promise<Host> =>
    (await ctx.repos.hosts.findOne({ where: { id: { eq: id } } })) as Host;

  it("emails the owner once on the flip, and not again the next night", async ({
    expect,
  }) => {
    const host = await seed("cf-flip");
    const seededAt = (await rowOf(host.id)).credentialCheckedAt;

    // Night one: everything still passes. Waiting on the stamp is what
    // makes the empty mailbox below mean anything.
    await ctx.dateTime.travel(1, "day");
    const checked = await waitFor(
      () => rowOf(host.id),
      (row) => row.credentialCheckedAt !== seededAt,
      "night one re-checked the host",
    );
    expect(ctx.cloudflare.credentialStatus(checked)).toBe("valid");
    expect(ctx.mail.records).toHaveLength(0);

    // Night two: the token has been narrowed at Cloudflare.
    ctx.probes.refuse("/d1/database");
    await ctx.dateTime.travel(1, "day");

    const flipped = await waitFor(
      () => rowOf(host.id),
      (row) => ctx.cloudflare.credentialStatus(row) === "invalid",
      "night two flipped the host to invalid",
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
      () => rowOf(host.id),
      (row) => row.credentialCheckedAt !== flippedAt,
      "night three re-checked the host",
    );
    expect(ctx.mail.records).toHaveLength(1);
  });

  it("isolates one host's failure from the rest of the sweep", async ({
    expect,
  }) => {
    const broken = await seed("cf-broken");
    const healthy = await seed("cf-healthy");
    // A row whose credential cannot be opened at all. Isolation is
    // structural since the split - the two hosts are separate executions,
    // so the broken one cannot reach the healthy one - and this pins that
    // the fan-out still queues past a row it cannot process.
    await ctx.repos.hosts.updateById(broken.id, {
      credential: "not:a:sealed-value",
    });
    const seededAt = (await rowOf(healthy.id)).credentialCheckedAt;

    await ctx.dateTime.travel(1, "day");

    const row = await waitFor(
      () => rowOf(healthy.id),
      (it) => it.credentialCheckedAt !== seededAt,
      "the healthy host was re-checked",
    );
    expect(ctx.cloudflare.credentialStatus(row)).toBe("valid");
  });

  it("changes nothing and tells nobody when Cloudflare is down", async ({
    expect,
  }) => {
    const host = await seed("cf-outage");
    ctx.probes.unreachable("/workers/scripts", 503);

    await ctx.dateTime.travel(1, "day");

    // The probe that answers 503 is the one that decides the outcome, so
    // its appearance in `calls` is the signal that the handler got far
    // enough for the assertions below to mean anything.
    await waitFor(
      () => ctx.probes.calls,
      (calls) => calls.some((path) => path.endsWith("/workers/scripts")),
      "the host was probed",
    );

    const row = await rowOf(host.id);
    // The whole reason the verdict has three values: an outage at midnight
    // must not flip every host in the instance and email every owner.
    expect(ctx.cloudflare.credentialStatus(row)).toBe("valid");
    expect(row.credentialError).toBeFalsy();
    expect(ctx.mail.records).toHaveLength(0);
  });
});
