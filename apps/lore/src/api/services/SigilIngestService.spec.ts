import type { SigilForwarded } from "@alepha/lore/sigil";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { defaultProjectFeatures } from "../entities/projects.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";
import { LoreApi } from "../index.ts";
import { SigilIngestService } from "./SigilIngestService.ts";

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

  // Before `LoreApi`, which injects the real service as it registers: a
  // substitution declared after that point is refused outright.
  alepha.with({ provide: SigilIngestService, use: OverlapProbe });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(SigilRepositories);

  await alepha.start();

  const project = await createTestProject(alepha, {
    features: { ...defaultProjectFeatures, sigils: true },
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
