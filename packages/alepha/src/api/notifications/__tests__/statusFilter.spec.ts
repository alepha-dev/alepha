import { Alepha } from "alepha";
import { AlephaApiJobs, type jobExecutionEntity } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import type { Repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaSms } from "alepha/sms";
import { describe, expect, it } from "vitest";
import { AdminNotificationController } from "../controllers/AdminNotificationController.ts";
import { AlephaApiNotifications } from "../index.ts";
import { notificationQuerySchema } from "../schemas/notificationQuerySchema.ts";

/**
 * The admin list declared a `status` query parameter and never applied it, so
 * every filter returned the unfiltered page. Its enum also used a vocabulary
 * (`retrying` / `completed` / `dead`) that the outbox never writes — the real
 * statuses are the `job_executions` ones.
 */
class TestAdminController extends AdminNotificationController {
  public get repo(): Repository<typeof jobExecutionEntity.schema> {
    return this.executions as never;
  }
  public get job(): string {
    return this.jobName;
  }
  public listPage(query: Record<string, unknown>) {
    return this.list(query as never);
  }
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaSecurity)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const controller = alepha.inject(TestAdminController);
  await alepha.start();
  return { alepha, controller };
};

describe("admin notification list — status filter", () => {
  it("only accepts statuses the outbox actually writes", () => {
    const values = (notificationQuerySchema.shape.status as any).unwrap()
      .options as string[];

    // These are the `job_executions.status` values. A filter option the
    // backend can never produce is a dead entry in the admin dropdown.
    expect([...values].sort()).toEqual(
      ["cancelled", "error", "ok", "pending", "running", "scheduled"].sort(),
    );
  });

  it("applies the status filter to the query", async () => {
    const { alepha, controller } = await setup();

    await controller.repo.createMany([
      { jobName: controller.job, status: "ok", payload: { name: "a" } },
      { jobName: controller.job, status: "ok", payload: { name: "b" } },
      { jobName: controller.job, status: "error", payload: { name: "c" } },
    ] as never);

    const errors = await controller.listPage({ status: "error" });
    expect(errors.content).toHaveLength(1);
    expect(errors.content[0].status).toBe("error");

    const oks = await controller.listPage({ status: "ok" });
    expect(oks.content).toHaveLength(2);

    await alepha.stop();
  });

  it("returns every notification when no status is given", async () => {
    const { alepha, controller } = await setup();

    await controller.repo.createMany([
      { jobName: controller.job, status: "ok", payload: { name: "a" } },
      { jobName: controller.job, status: "error", payload: { name: "b" } },
    ] as never);

    const all = await controller.listPage({});
    expect(all.content).toHaveLength(2);

    await alepha.stop();
  });
});
