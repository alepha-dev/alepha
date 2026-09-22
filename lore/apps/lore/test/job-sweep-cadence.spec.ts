import { Alepha } from "alepha";
import { jobConfig } from "alepha/api/jobs";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { LoreApi } from "../src/api/index.ts";
import { DeployJobs } from "../src/api/jobs/DeployJobs.ts";

/**
 * A queue delivery Cloudflare loses leaves a `pending` row that only the
 * framework's sweep re-dispatches: on 2026-09-22 a deploy waited 827 s for
 * it (#Q2478). Lore sweeps every five minutes and calls a row lost after
 * one, and does it on an expression another Lore cron already uses: cron
 * triggers are counted per account, so a new one is not free.
 */
describe("job sweep cadence", () => {
  it("sweeps every five minutes on a shared expression, a row lost after one", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
        DATABASE_URL: ":memory:",
        APP_SECRET: "a-strong-and-unique-app-secret-for-tests",
      },
    });
    // As `main.server.ts` does it: before any module.
    alepha.set(jobConfig, {
      ...alepha.store.get(jobConfig),
      ...DeployJobs.JOB_SWEEP,
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(LoreApi);
    await alepha.start();
    try {
      expect(alepha.store.get(jobConfig).staleThreshold).toBe(60_000);

      const crons = alepha.inject(CronProvider).getCronJobs();
      const sweep = crons.find((c) => c.name === "system.jobs.sweep");
      expect(sweep?.expression).toBe("*/5 * * * *");
      // Shared with a cron Lore already runs: no new trigger to pay for.
      const abandoned = crons.find((c) => c.name.includes("sweep-abandoned"));
      expect(abandoned?.expression).toBe(sweep?.expression);
    } finally {
      await alepha.stop();
    }
  });
});
