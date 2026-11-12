import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  JobProvider,
  jobCronClaimEntity,
} from "../index.ts";

class TestJobProvider extends JobProvider {
  public testClaim = this.claimCronInstant.bind(this);
  public testTrimCronClaims = this.trimCronClaims.bind(this);
}

class App {
  claims = $repository(jobCronClaimEntity);
  tick = $job({
    name: "app.tick",
    description: "A job under test.",
    cron: "0 0 * * *",
    handler: async () => {},
  });
}

const boot = async (driver: "postgres" | "sqlite" = "postgres") => {
  const base =
    driver === "sqlite"
      ? Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } })
      : Alepha.create().with(AlephaOrmTestPostgres);
  const alepha = base
    .with({ provide: JobProvider, use: TestJobProvider })
    .with(AlephaApiJobs);
  alepha.inject(DateTimeProvider).pause();
  const app = alepha.inject(App);
  await alepha.start();
  const jobs = alepha.inject(TestJobProvider);
  const registration = jobs.getRegisteredJobs().get("app.tick")!;
  return { alepha, app, jobs, registration };
};

describe("$job cron claims", () => {
  it("claims an instant once, in the database, and the next instant again", async ({
    expect,
  }) => {
    const { alepha, app, jobs, registration } = await boot();
    const dt = alepha.inject(DateTimeProvider);
    const instant = dt.of("2026-01-01T00:00:00.000Z");

    expect(await jobs.testClaim(registration, instant)).toBe(true);
    expect(await jobs.testClaim(registration, instant)).toBe(false);
    expect(
      await jobs.testClaim(registration, dt.of("2026-01-02T00:00:00.000Z")),
    ).toBe(true);

    const rows = await app.claims.findMany({
      where: { jobName: { eq: "app.tick" } },
    });
    expect(rows.map((r) => r.id).sort()).toEqual([
      "app.tick@2026-01-01T00:00:00.000Z",
      "app.tick@2026-01-02T00:00:00.000Z",
    ]);
  });

  for (const driver of ["postgres", "sqlite"] as const) {
    it(`trims claims more than a day old and keeps recent ones (${driver})`, async ({
      expect,
    }) => {
      const { alepha, app, jobs, registration } = await boot(driver);
      const dt = alepha.inject(DateTimeProvider);
      const recent = dt.now().subtract(1, "hour");

      await jobs.testClaim(registration, dt.now().subtract(2, "day"));
      await jobs.testClaim(registration, recent);

      await jobs.testTrimCronClaims();

      const rows = await app.claims.findMany({
        where: { jobName: { eq: "app.tick" } },
      });
      expect(rows.map((r) => r.id)).toEqual([
        `app.tick@${recent.toISOString()}`,
      ]);
    });
  }
});
