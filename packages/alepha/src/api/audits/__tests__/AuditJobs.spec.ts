import { $module, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { $audit, AlephaApiAudits, AuditJobs, audits } from "../index.ts";

/**
 * Audit type with a dedicated 7-day retention, to exercise the per-type
 * override path through the real `$audit` registry.
 */
class ShortAudits {
  audit = $audit({
    type: "av-job-short",
    description: "Short-lived audit type for retention tests",
    actions: ["x"],
    retentionDays: 7,
  });
}

class Db {
  audits = $repository(audits);
}

const alepha = Alepha.create()
  .with(AlephaOrmPostgres)
  .with(AlephaApiAudits)
  .with($module({ name: "test.audits.jobs", services: [ShortAudits] }));

const db = alepha.inject(Db);

describe("AuditJobs", () => {
  it("prunes expired entries by default and per-type retention", async ({
    expect,
  }) => {
    const time = alepha.inject(DateTimeProvider);
    const jobs = alepha.inject(AuditJobs);
    // Ensure the $audit holder is initialized so its type is registered.
    alepha.inject(ShortAudits);

    const defaultType = "av-job-default";
    await db.audits.deleteMany({ type: { eq: defaultType } });
    await db.audits.deleteMany({ type: { eq: "av-job-short" } });

    // Default-retention type (90d global default): one old, one recent.
    await db.audits.create({
      type: defaultType,
      action: "x",
      createdAt: time.now().subtract(120, "day").toISOString(),
    });
    await db.audits.create({
      type: defaultType,
      action: "x",
      createdAt: time.nowISOString(),
    });

    // Dedicated 7-day type: one beyond its window, one within.
    await db.audits.create({
      type: "av-job-short",
      action: "x",
      createdAt: time.now().subtract(30, "day").toISOString(),
    });
    await db.audits.create({
      type: "av-job-short",
      action: "x",
      createdAt: time.nowISOString(),
    });

    await jobs.cleanExpired.trigger();

    const remainingDefault = await db.audits.findMany({
      where: { type: { eq: defaultType } },
    });
    const remainingShort = await db.audits.findMany({
      where: { type: { eq: "av-job-short" } },
    });

    // Old default-type entry pruned (120d > 90d), recent kept.
    expect(remainingDefault.length).toBe(1);
    // 30d entry pruned by the 7-day override, recent kept.
    expect(remainingShort.length).toBe(1);
  });
});
