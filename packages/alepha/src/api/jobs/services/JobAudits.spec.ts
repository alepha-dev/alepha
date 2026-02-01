import { Alepha } from "alepha";
import { AlephaApiAudits, AuditService } from "alepha/api/audits";
import { AlephaOrm } from "alepha/orm";
import { describe, test } from "vitest";
import { JobAudits } from "./JobAudits.ts";

describe("JobAudits", () => {
  test("should log trigger event", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrm).with(AlephaApiAudits);

    const jobAudits = alepha.inject(JobAudits);
    const auditService = alepha.inject(AuditService);
    await alepha.start();

    // Log a trigger event
    await jobAudits.logTrigger("my-test-job");

    // Verify audit was recorded
    const audits = await auditService.find({ type: "job", action: "trigger" });

    expect(audits.content).toHaveLength(1);
    expect(audits.content[0].type).toBe("job");
    expect(audits.content[0].action).toBe("trigger");
    expect(audits.content[0].resourceType).toBe("job");
    expect(audits.content[0].resourceId).toBe("my-test-job");
    expect(audits.content[0].description).toBe(
      "Manually triggered job: my-test-job",
    );
  });

  test("should log pause event", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrm).with(AlephaApiAudits);

    const jobAudits = alepha.inject(JobAudits);
    const auditService = alepha.inject(AuditService);
    await alepha.start();

    await jobAudits.logPause("daily-cleanup");

    const audits = await auditService.find({ type: "job", action: "pause" });

    expect(audits.content).toHaveLength(1);
    expect(audits.content[0].resourceId).toBe("daily-cleanup");
    expect(audits.content[0].description).toBe("Paused job: daily-cleanup");
  });

  test("should log schedule change with cron metadata", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrm).with(AlephaApiAudits);

    const jobAudits = alepha.inject(JobAudits);
    const auditService = alepha.inject(AuditService);
    await alepha.start();

    await jobAudits.logScheduleChange("backup-job", {
      oldCron: "0 0 * * *",
      newCron: "0 3 * * *",
    });

    const audits = await auditService.find({
      type: "job",
      action: "schedule_change",
    });

    expect(audits.content).toHaveLength(1);
    expect(audits.content[0].resourceId).toBe("backup-job");
    expect(audits.content[0].metadata).toEqual({
      oldCron: "0 0 * * *",
      newCron: "0 3 * * *",
    });
  });

  test("should register job audit type", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrm).with(AlephaApiAudits);

    alepha.inject(JobAudits);
    const auditService = alepha.inject(AuditService);
    await alepha.start();

    const types = auditService.getRegisteredTypes();
    const jobType = types.find((t) => t.type === "job");

    expect(jobType).toBeDefined();
    expect(jobType?.actions).toContain("trigger");
    expect(jobType?.actions).toContain("pause");
    expect(jobType?.actions).toContain("resume");
    expect(jobType?.actions).toContain("cancel");
    expect(jobType?.actions).toContain("schedule_change");
  });
});
