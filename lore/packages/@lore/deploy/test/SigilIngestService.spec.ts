import type { SigilForwarded } from "@alepha/lore/sigil";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LoreDeployApi } from "../src/api/index.ts";
import { SigilIngestService } from "../src/api/index.ts";
import { type Sigil, sigils } from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

/**
 * Records when each section of a batch starts and finishes, without touching
 * the database.
 *
 * Overriding the three sections rather than instrumenting the driver because
 * the question is about `absorb`'s own orchestration: whether it waits for
 * one section before beginning the next. Each override yields once, so a
 * sequential `absorb` produces `start,end,start,end,...` and a concurrent one
 * produces every `start` before the first `end`.
 */
class OverlapProbe extends SigilIngestService {
  public readonly trace: string[] = [];

  protected override async absorbErrors(): Promise<void> {
    await this.section("errors");
  }

  protected override async absorbViews(): Promise<void> {
    await this.section("views");
  }

  protected override async absorbVitals(): Promise<void> {
    await this.section("vitals");
  }

  protected async section(name: string): Promise<void> {
    this.trace.push(`${name}:start`);
    await Promise.resolve();
    this.trace.push(`${name}:end`);
  }
}

interface TestContext {
  alepha: Alepha;
  ingest: OverlapProbe;
  sigil: Sigil;
}

/**
 * `sigils` is not part of `DeployTestEntities`, so this spec registers it
 * itself — pre-`start()`, like everything else the schema sync has to see. Its
 * own FK closure (`projects`, `users`) is covered by that class.
 */
class SigilRepositories {
  sigils = $repository(sigils);
}

/**
 * `DATABASE_URL` is pinned for the same reason every other lore spec pins it:
 * the root vitest config points it at Postgres, which this app's SQLite
 * provider rejects outright.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  // Before `LoreDeployApi`, which injects the real service as it registers: a
  // substitution declared after that point is refused outright.
  alepha.with({ provide: SigilIngestService, use: OverlapProbe });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreDeployApi);

  alepha.inject(DeployTestEntities);
  const repos = alepha.inject(SigilRepositories);

  await alepha.start();

  // `apps.track` is what `features.sigils` was: the switch above the
  // telemetry surfaces that `gatesFor` reads.
  const project = await createTestProject(alepha, {
    capabilities: [{ key: "apps", options: { track: true } }],
  });

  const sigil = await repos.sigils.create({
    projectId: project.id,
    name: "probe",
    tokenHash: "hash-probe",
    tokenPrefix: "sg_probe",
    kinds: ["blights", "beacon", "vitals"],
  });

  return {
    alepha,
    ingest: alepha.inject(SigilIngestService) as OverlapProbe,
    sigil,
  };
};

const envelope: SigilForwarded = {
  errors: [
    {
      name: "TypeError",
      message: "boom",
      stack: "TypeError: boom",
      sourceUrl: "/",
      origin: "client",
    },
  ],
  views: [{ path: "/", ts: 1 }],
  vitals: [{ path: "/", metric: "lcp", value: 1200, ts: 1 }],
  host: "example.test",
};

describe("SigilIngestService.absorb", () => {
  /**
   * The three sections write to disjoint tables and each depends only on
   * `gatesFor`, so nothing orders them. Awaiting them in turn spends three
   * round trips to the D1 primary where one would do — which is most of the
   * ~900ms a healthy `/sigils/ingest` costs today, and most of the headroom
   * a stalled primary eats before the 5s ceiling fires.
   */
  it("runs the independent sections of a batch concurrently", async () => {
    const { ingest, sigil } = await setup();

    await ingest.absorb(sigil, envelope);

    const firstEnd = ingest.trace.findIndex((step) => step.endsWith(":end"));
    const starts = ingest.trace
      .slice(0, firstEnd)
      .filter((step) => step.endsWith(":start"));

    expect(starts).toHaveLength(3);
  });

  /**
   * The liveness stamp is the one statement deliberately left sequential, so
   * it needs its own assertion: the overlap test above would stay green if it
   * were dropped altogether.
   *
   * Why it stays behind the sections rather than joining them is in `absorb`,
   * and `test/lore-analytics.spec.ts` owns the failing half of that rule.
   */
  it("still stamps liveness and the reported host", async () => {
    const { alepha, ingest, sigil } = await setup();
    const repos = alepha.inject(SigilRepositories);

    await ingest.absorb(sigil, envelope);

    const stored = await repos.sigils.findOne({
      where: { id: { eq: sigil.id } },
    });

    expect(stored?.lastSeenAt).toBeTruthy();
    expect(stored?.lastSeenHost).toBe("example.test");
  });
});

interface HostTestContext {
  alepha: Alepha;
  ingest: SigilIngestService;
  repos: SigilRepositories;
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config — the one CI
 * runs — sets `DATABASE_URL` to a Postgres URL, which this app's SQLite
 * provider rejects outright. A bare `Alepha.create()` passes under
 * `yarn w lore test` and fails under `yarn test`.
 */
const setupHost = async (): Promise<HostTestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreDeployApi);

  alepha.inject(DeployTestEntities);
  const repos = alepha.inject(SigilRepositories);

  await alepha.start();

  return {
    alepha,
    ingest: alepha.inject(SigilIngestService),
    repos,
  };
};

/**
 * A sigil row straight through the repository, bypassing the token service.
 * Nothing here reads the credential — every test drives the ingest service with
 * the row itself.
 */
let sigilSeq = 0;
const createTestSigil = async (
  ctx: HostTestContext,
  projectId: number,
  overrides: Partial<Sigil> = {},
): Promise<Sigil> => {
  sigilSeq += 1;
  return ctx.repos.sigils.create({
    projectId,
    name: `app-${sigilSeq}`,
    tokenHash: `hash-${sigilSeq}`,
    tokenPrefix: "sg_test_",
    kinds: ["beacon"],
    ...overrides,
  });
};

describe("SigilIngestService — the host an app reports from", () => {
  let ctx: HostTestContext;

  beforeEach(async () => {
    ctx = await setupHost();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("records the host, beside the timestamp it already stamped", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id);

    await ctx.ingest.absorb(sigil, {
      views: [{ path: "/" }],
      host: "alepha.dev",
    });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
    expect(stored.lastSeenAt).toBeTruthy();
  });

  it("records it even for a batch every gate rejected", async ({ expect }) => {
    // The fixture project has no `features`, so nothing in this envelope is
    // written. Where the app answers is Lore's own bookkeeping, like
    // `lastSeenAt` — it does not depend on what the app was allowed to say.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, { kinds: [] });

    await ctx.ingest.absorb(sigil, {
      views: [{ path: "/" }],
      host: "alepha.dev",
    });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
  });

  it("normalizes what it is given rather than trusting it", async ({
    expect,
  }) => {
    // The sender ran the same normalization, and the sender is whoever holds
    // the token.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id);

    await ctx.ingest.absorb(sigil, { host: "ALEPHA.dev." });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
  });

  it("ignores a host that is not an authority", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id);

    await ctx.ingest.absorb(sigil, { host: "https://evil.example.com/x" });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost ?? null).toBeNull();
  });

  it("keeps the last known host when a batch names none", async ({
    expect,
  }) => {
    // A cron, a queue worker, or a server error raised at boot has no inbound
    // request to name. Letting that clear the column would make the address
    // blink empty in the UI every time an app reported from anywhere but a
    // page view.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, {
      lastSeenHost: "alepha.dev",
    });

    await ctx.ingest.absorb(sigil, { views: [{ path: "/" }] });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
  });

  it("follows an app that moves domain", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, {
      lastSeenHost: "old.example.com",
    });

    await ctx.ingest.absorb(sigil, { host: "alepha.dev" });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
  });
});
